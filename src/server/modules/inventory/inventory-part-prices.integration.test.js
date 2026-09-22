import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { appendInventoryPartPrice, getInventoryPartCommercial } from "../../db/repositories/inventory-part-prices.repo.js";
import { createInventoryTaxProfileRepo, readInventoryTaxProfileVersion, reviseInventoryTaxProfileRepo, setInventoryTaxProfileArchivedRepo } from "../../db/repositories/inventory-tax-profiles.repo.js";
import { closePool, query } from "../../db/pool.js";

const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === "1";
after(async () => { if (runPostgres) await closePool(); });

test("real PostgreSQL versions prices, distinguishes zero from Unknown and serializes competing writers", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID(); const companyId = randomUUID(); const locationId = randomUUID(); const partId = randomUUID();
  const base = { catalogPartId: partId, companyIds: [companyId], actorId, kind: "internal", reason: "Integration price" };
  const command = (expectedVersion, amount, currency, key) => ({ ...base, expectedVersion, amount, currency, idempotencyKey: key, requestHash: createHash("sha256").update(`${expectedVersion}:${amount}:${currency}`).digest("hex") });
  try {
    await query("insert into user_profiles(id,display_name) values($1,'Price integration')", [actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Price integration')", [companyId, `price-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Price shop')", [locationId, companyId]);
    await query("insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code) values($1,$2,$3,$4,'Price part','ea')", [partId, companyId, `PRICE${suffix}`, `PRICE-${suffix}`]);
    const zero = await appendInventoryPartPrice(command(0, "0.0000", "USD", `zero-${suffix}`));
    assert.equal(zero.price.status, "known"); assert.equal(zero.price.amount, "0.0000");
    const cleared = await appendInventoryPartPrice(command(1, null, null, `clear-${suffix}`));
    assert.equal(cleared.price.status, "unknown"); assert.equal(cleared.price.version, 2);
    const replay = await appendInventoryPartPrice(command(1, null, null, `clear-${suffix}`));
    assert.equal(replay.replayed, true);
    const [left, right] = await Promise.all([
      appendInventoryPartPrice(command(2, "3.0000", "USD", `race-a-${suffix}`)),
      appendInventoryPartPrice(command(2, "4.0000", "USD", `race-b-${suffix}`)),
    ]);
    assert.deepEqual([left.kind, right.kind].sort(), ["saved", "stale"]);
    const detail = await getInventoryPartCommercial({ catalogPartId: partId, companyIds: [companyId], locationIds: [locationId], isAdmin: false });
    assert.equal(detail.purchaseCost.status, "unknown");
    assert.equal(detail.prices.internal.current.version, 3);
    assert.equal(detail.prices.selling.current, null);
    const locationUnknown = await appendInventoryPartPrice({
      ...base, locationId, locationIds: [locationId], expectedVersion: 0, amount: null, currency: null,
      taxTreatment: "not_configured", taxProfileVersionId: null,
      idempotencyKey: `location-unknown-${suffix}`, requestHash: createHash("sha256").update("location-unknown").digest("hex"),
    });
    assert.equal(locationUnknown.price.status, "unknown");
    const locationReplay = await appendInventoryPartPrice({
      ...base, locationId, locationIds: [locationId], expectedVersion: 0, amount: null, currency: null,
      taxTreatment: "not_configured", taxProfileVersionId: null,
      idempotencyKey: `location-unknown-${suffix}`, requestHash: createHash("sha256").update("location-unknown").digest("hex"),
    });
    assert.equal(locationReplay.replayed, true);
    const locationStale = await appendInventoryPartPrice({
      ...base, locationId, locationIds: [locationId], expectedVersion: 0, amount: "1", currency: "USD",
      taxTreatment: "not_configured", taxProfileVersionId: null,
      idempotencyKey: `location-stale-${suffix}`, requestHash: createHash("sha256").update("location-stale").digest("hex"),
    });
    assert.equal(locationStale.kind, "stale");
    const locationDetail = await getInventoryPartCommercial({ catalogPartId: partId, companyIds: [companyId], locationIds: [locationId], locationId, isAdmin: false });
    assert.equal(locationDetail.prices.internal.source, "location_override");
    assert.equal(locationDetail.prices.internal.effective.status, "unknown");
    assert.equal(locationDetail.prices.internal.override.current.version, 1);
    assert.equal(locationDetail.prices.internal.companyDefault.current.version, 3);
    const defaultDetail = await getInventoryPartCommercial({ catalogPartId: partId, companyIds: [companyId], locationIds: [locationId], isAdmin: false });
    assert.equal(defaultDetail.prices.internal.source, "company_default");
    assert.equal(defaultDetail.prices.internal.current.version, 3);
    const sharedKey = `shared-${suffix}`;
    const [differentKindLeft, differentKindRight] = await Promise.all([
      appendInventoryPartPrice({ ...base, expectedVersion: 3, amount: "5", currency: "USD", taxTreatment: "not_configured", taxProfileVersionId: null, idempotencyKey: sharedKey, requestHash: createHash("sha256").update("shared-internal").digest("hex") }),
      appendInventoryPartPrice({ ...base, kind: "selling", expectedVersion: 0, amount: "6", currency: "USD", taxTreatment: "not_configured", taxProfileVersionId: null, idempotencyKey: sharedKey, requestHash: createHash("sha256").update("shared-selling").digest("hex") }),
    ]);
    assert.deepEqual([differentKindLeft.kind, differentKindRight.kind].sort(), ["idempotency_conflict", "saved"]);
  } finally {
    await query("delete from inventory_part_price_versions where company_id=$1", [companyId]).catch(() => {});
    await query("delete from parts_catalog where company_id=$1", [companyId]).catch(() => {});
    await query("delete from locations where company_id=$1", [companyId]).catch(() => {});
    await query("delete from companies where id=$1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id=$1", [actorId]).catch(() => {});
  }
});

test("real PostgreSQL keeps tax profiles immutable, tenant-scoped and historically resolvable after archive", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID(); const companyId = randomUUID(); const otherCompanyId = randomUUID(); const partId = randomUUID();
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const profileBase = {
    companyId, actorId, name: "Integration tax", currency: "USD", jurisdiction: "Integration jurisdiction",
    components: [{ name: "State tax", rate: "6.5000", compound: false }], reason: "Integration profile",
    idempotencyKey: `profile-${suffix}`, requestHash: hash("profile-create"),
  };
  try {
    await query("insert into user_profiles(id,display_name) values($1,'Tax integration')", [actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Tax integration'),($3,$4,'Other tax company')", [companyId, `tax-${suffix}`, otherCompanyId, `other-${suffix}`]);
    await query("insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode) values($1,$2,$3,$4,'Tax part','ea','quantity')", [partId, companyId, `TAX${suffix}`, `TAX-${suffix}`]);
    const created = await createInventoryTaxProfileRepo(profileBase);
    assert.equal(created.profile.current.version, 1);
    const replay = await createInventoryTaxProfileRepo(profileBase);
    assert.equal(replay.replayed, true);
    const profileId = created.profile.id;
    const revised = await reviseInventoryTaxProfileRepo({ ...profileBase, profileId, expectedVersion: 1, name: "Integration tax revised", components: [{ name: "State tax", rate: "7.0000", compound: false }], idempotencyKey: `revise-${suffix}`, requestHash: hash("profile-revise") });
    assert.equal(revised.profile.current.version, 2);
    const versionId = revised.profile.current.id;
    assert.equal(await readInventoryTaxProfileVersion({ companyIds: [otherCompanyId], taxProfileVersionId: versionId }), null);
    const savedPrice = await appendInventoryPartPrice({ catalogPartId: partId, companyIds: [companyId], actorId, kind: "selling", expectedVersion: 0, amount: "12.0000", currency: "USD", taxTreatment: "exclusive", taxProfileVersionId: versionId, reason: "Taxable price", idempotencyKey: `price-${suffix}`, requestHash: hash("taxable-price") });
    assert.equal(savedPrice.price.taxProfile.id, versionId);
    const archived = await setInventoryTaxProfileArchivedRepo({ ...profileBase, profileId, expectedVersion: 2, archived: true, reason: "Archive integration profile", idempotencyKey: `archive-${suffix}`, requestHash: hash("profile-archive") });
    assert.equal(archived.profile.archived, true);
    const detail = await getInventoryPartCommercial({ catalogPartId: partId, companyIds: [companyId], isAdmin: true });
    assert.equal(detail.prices.selling.current.taxProfile.id, versionId);
    const rejected = await appendInventoryPartPrice({ catalogPartId: partId, companyIds: [companyId], actorId, kind: "internal", expectedVersion: 0, amount: "12", currency: "USD", taxTreatment: "exclusive", taxProfileVersionId: versionId, reason: "Archived profile", idempotencyKey: `archived-price-${suffix}`, requestHash: hash("archived-price") });
    assert.equal(rejected.kind, "tax_profile_invalid");
    await assert.rejects(() => query("update inventory_tax_profile_versions set name='Mutated' where id=$1", [versionId]), (error) => error.code === "55000");
  } finally {
    await query("delete from inventory_part_price_versions where company_id=$1", [companyId]);
    await query("delete from inventory_tax_profiles where company_id=$1", [companyId]);
    await query("delete from parts_catalog where company_id=$1", [companyId]);
    await query("delete from companies where id=any($1::uuid[])", [[companyId, otherCompanyId]]);
    await query("delete from user_profiles where id=$1", [actorId]);
    const residue = await query(`select
      (select count(*) from inventory_tax_profiles where company_id=$1)
      + (select count(*) from companies where id=any($2::uuid[]))
      + (select count(*) from user_profiles where id=$3) as count`, [companyId, [companyId, otherCompanyId], actorId]);
    assert.equal(Number(residue.rows[0].count), 0);
  }
});

test("real PostgreSQL cost coverage includes scoped costless receipts and keeps a newer Unknown visible", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID(); const companyId = randomUUID(); const assignedId = randomUUID(); const otherId = randomUUID(); const partId = randomUUID();
  const runId = randomUUID(); const knownReceiptId = randomUUID(); const knownLineId = randomUUID(); const unknownReceiptId = randomUUID(); const unknownLineId = randomUUID(); const hiddenReceiptId = randomUUID(); const hiddenLineId = randomUUID();
  const draft = JSON.stringify({ documentType: { value: "invoice" }, vendorName: { value: "Scoped vendor" }, invoiceNumber: { value: `INV-${suffix}` }, invoiceDate: { value: "2026-09-01" }, currency: { value: "CAD" }, total: { value: 20 }, lines: [] });
  try {
    await query("insert into user_profiles(id,display_name) values($1,'Cost coverage integration')", [actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Cost coverage integration')", [companyId, `cost-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Assigned'),($3,$2,'Hidden')", [assignedId, companyId, otherId]);
    await query("insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code) values($1,$2,$3,$4,'Cost part','ea')", [partId, companyId, `COST${suffix}`, `COST-${suffix}`]);
    await query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at)
      values($1,$2,$3,$4,$4,$5,'cost.pdf','application/pdf',1,$6,'reviewed','local-test','local-test','local-v1',$7,now())`, [runId, companyId, assignedId, actorId, createHash("sha256").update(suffix).digest("hex"), `invoice-${suffix}`, draft]);
    await query(`insert into local_inventory_receipts(id,company_id,location_id,invoice_run_id,created_by,idempotency_key,request_hash,status,line_count,total_quantity,posted_at,reviewed_run_version,physical_confirmation,confirmation_hash)
      values($1,$2,$3,$4,$5,$6,$7,'posted',1,2,now()-interval '1 day',1,'all_received_undamaged',$7)`, [knownReceiptId, companyId, assignedId, runId, actorId, `local-${suffix}`, createHash("sha256").update(`local-${suffix}`).digest("hex")]);
    await query(`insert into inventory_receipts(id,company_id,location_id,invoice_run_id,created_by,idempotency_key,provider,provider_marker,status,confirmed_at)
      values($1,$2,$3,$4,$5,$6,'local',$7,'confirmed',now()-interval '1 day')`, [knownReceiptId, companyId, assignedId, runId, actorId, `generic-${suffix}`, `LOCAL-${suffix}`]);
    await query(`insert into inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode)
      values($1,$2,$3,0,$4,$5,$6,'Cost part',2,'ea','aggregate')`, [knownLineId, companyId, knownReceiptId, partId, `local:${partId}`, `COST-${suffix}`]);
    await query(`insert into local_inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,normalized_part_number,part_number,description,quantity,uom_code,unit_cost,line_total)
      values($1,$2,$3,0,$4,$5,$6,'Cost part',2,'ea',10,20)`, [knownLineId, companyId, knownReceiptId, partId, `COST${suffix}`, `COST-${suffix}`]);
    for (const [receiptId, lineId, locationId, quantity, offset] of [[unknownReceiptId, unknownLineId, assignedId, 3, 0], [hiddenReceiptId, hiddenLineId, otherId, 7, 1]]) {
      await query(`insert into inventory_receipts(id,company_id,location_id,created_by,idempotency_key,provider,provider_marker,status,confirmed_at)
        values($1,$2,$3,$4,$5,'legacy_tracking',$6,'confirmed',now()+($7*interval '1 second'))`, [receiptId, companyId, locationId, actorId, `legacy-${lineId}`, `LEGACY-${lineId}`, offset]);
      await query(`insert into inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode)
        values($1,$2,$3,0,$4,$5,$6,'Cost part',$7,'ea','aggregate')`, [lineId, companyId, receiptId, partId, `legacy:${lineId}`, `COST-${suffix}`, quantity]);
    }
    const detail = await getInventoryPartCommercial({ catalogPartId: partId, companyIds: [companyId], locationIds: [assignedId], locationId: assignedId, isAdmin: false });
    assert.deepEqual(detail.purchaseCost.coverage, { knownQuantity: 2, unknownQuantity: 3, knownLines: 1, unknownLines: 1 });
    assert.equal(detail.purchaseCost.status, "partial");
    assert.equal(detail.purchaseCost.latest.status, "unknown");
    assert.equal(detail.receiptCosts.basis, "receipt_line_source_facts");
    assert.equal(detail.purchaseCost.observations.some((entry) => entry.locationId === otherId), false);
    const known = detail.purchaseCost.observations.find((entry) => entry.status === "known");
    assert.equal(known.currency, "CAD");
    assert.equal(known.basis, "source_invoice_line");
    assert.equal(known.invoice.runId, runId);
    assert.equal(detail.purchaseCost.latest.basis, "unpriced_receipt");
  } finally {
    await query("delete from inventory_receipt_lines where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_receipts where company_id=$1", [companyId]).catch(() => {});
    await query("delete from local_inventory_receipt_lines where company_id=$1", [companyId]).catch(() => {});
    await query("delete from local_inventory_receipts where company_id=$1", [companyId]).catch(() => {});
    await query("delete from invoice_extraction_runs where company_id=$1", [companyId]).catch(() => {});
    await query("delete from parts_catalog where company_id=$1", [companyId]).catch(() => {});
    await query("delete from locations where company_id=$1", [companyId]).catch(() => {});
    await query("delete from companies where id=$1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id=$1", [actorId]).catch(() => {});
  }
});
