import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import {
  listLocalInvoiceHistory,
  listLocalInventoryStock,
  postLocalInventoryReceipt,
} from "../../db/repositories/local-inventory.repo.js";
import { closePool, query } from "../../db/pool.js";

const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === "1";

after(async () => {
  if (runPostgres) await closePool();
});

test("real PostgreSQL pages invoice history inside authenticated location scope", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyId = randomUUID();
  const locationId = randomUUID();
  const otherLocationId = randomUUID();
  const runIds = [randomUUID(), randomUUID(), randomUUID()];
  const draft = JSON.stringify({
    vendorName: { value: `History ${suffix}` },
    invoiceNumber: { value: `H-${suffix}` },
    invoiceDate: { value: "2026-08-28" },
    currency: { value: "USD" },
    total: { value: 10 },
    lines: [], warnings: [],
  });
  try {
    await query("insert into user_profiles (id, display_name) values ($1, $2)", [actorId, `History ${suffix}`]);
    await query("insert into companies (id, slug, name) values ($1, $2, $3)", [companyId, `history-${suffix}`, "History integration"]);
    await query(
      "insert into locations (id, company_id, name) values ($1, $2, 'Assigned'), ($3, $2, 'Other')",
      [locationId, companyId, otherLocationId],
    );
    for (let index = 0; index < runIds.length; index += 1) {
      await query(
        `insert into invoice_extraction_runs (
           id, company_id, location_id, created_by, reviewed_by, document_hash,
           file_name, mime_type, byte_size, idempotency_key, status, provider,
           model, prompt_version, reviewed_draft, reviewed_at, created_at
         ) values ($1, $2, $3, $4, $4, $5, $6, 'application/pdf', 1, $7,
           'reviewed', 'local-test', 'local-test', 'local-v1', $8, now(), now() + ($9 * interval '1 second'))`,
        [runIds[index], companyId, index === 2 ? otherLocationId : locationId,
          actorId, createHash("sha256").update(`${suffix}-${index}`).digest("hex"),
          `history-${index}.pdf`, `history-${suffix}-${index}`, draft, index],
      );
    }
    const firstPage = await listLocalInvoiceHistory({
      companyIds: [companyId], locationIds: [locationId], isAdmin: false,
      queryText: `H-${suffix}`, limit: 1, offset: 0,
    });
    const secondPage = await listLocalInvoiceHistory({
      companyIds: [companyId], locationIds: [locationId], isAdmin: false,
      queryText: `H-${suffix}`, limit: 1, offset: 1,
    });
    const emptyPage = await listLocalInvoiceHistory({
      companyIds: [companyId], locationIds: [locationId], isAdmin: false,
      queryText: `H-${suffix}`, limit: 1, offset: 99,
    });
    assert.equal(firstPage.total, 2);
    assert.equal(firstPage.items.length, 1);
    assert.equal(secondPage.total, 2);
    assert.equal(secondPage.items.length, 1);
    assert.equal(emptyPage.total, 2);
    assert.deepEqual(emptyPage.items, []);
    assert.notEqual(firstPage.items[0].id, secondPage.items[0].id);
    assert.ok(![firstPage.items[0].id, secondPage.items[0].id].includes(runIds[2]));
  } finally {
    await query("delete from invoice_extraction_runs where company_id = $1", [companyId]).catch(() => {});
    await query("delete from locations where company_id = $1", [companyId]).catch(() => {});
    await query("delete from companies where id = $1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id = $1", [actorId]).catch(() => {});
  }
});

test("real PostgreSQL sorts stock by stocked locations before pagination with deterministic ties", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = randomUUID();
  const locationIds = [randomUUID(), randomUUID(), randomUUID()];
  const parts = [
    { id: randomUUID(), number: `LOC-A-${suffix}`, balances: [[0, 1], [1, 1]] },
    { id: randomUUID(), number: `LOC-B-${suffix}`, balances: [[2, 100]] },
    { id: randomUUID(), number: `LOC-D-${suffix}`, balances: [[1, 100]] },
    { id: randomUUID(), number: `LOC-Z-${suffix}`, balances: [] },
  ];
  try {
    await query("insert into companies (id, slug, name) values ($1, $2, $3)", [companyId, `stock-sort-${suffix}`, "Stock sort integration"]);
    await query(
      "insert into locations (id, company_id, name) values ($1, $4, 'Alpha'), ($2, $4, 'Bravo'), ($3, $4, 'Charlie')",
      [...locationIds, companyId],
    );
    for (const part of parts) {
      await query(
        `insert into parts_catalog (
           id, company_id, normalized_part_number, part_number, description, uom_code
         ) values ($1, $2, $3, $3, 'Location sort fixture', 'ea')`,
        [part.id, companyId, part.number],
      );
      for (const [locationIndex, quantity] of part.balances) {
        await query(
          `insert into inventory_items (
             company_id, location_id, catalog_part_id, normalized_part_number, part_number,
             description, quantity_on_hand, quantity_reserved, uom_code, source_provider, external_id
           ) values ($1, $2, $3, $4, $4, 'Location sort fixture', $5, 0, 'ea', 'local', $6)`,
          [companyId, locationIds[locationIndex], part.id, part.number, quantity, `stock-sort:${part.id}:${locationIndex}`],
        );
      }
    }

    const pages = await Promise.all([0, 1, 2, 3].map((offset) => listLocalInventoryStock({
      companyIds: [companyId],
      isAdmin: true,
      queryText: suffix,
      sort: "locations_desc",
      limit: 1,
      offset,
    })));

    assert.deepEqual(pages.map((page) => page[0].partNumber), parts.map((part) => part.number));
    assert.deepEqual(pages.map((page) => page[0].locationCount), [2, 1, 1, 0]);
    assert.ok(pages.every((page) => page[0].locations.length === 3), "detail locations stay complete and do not drive the sort");
    assert.equal(pages[0].total, 4);
  } finally {
    await query("delete from inventory_items where company_id = $1", [companyId]).catch(() => {});
    await query("delete from parts_catalog where company_id = $1", [companyId]).catch(() => {});
    await query("delete from locations where company_id = $1", [companyId]).catch(() => {});
    await query("delete from companies where id = $1", [companyId]).catch(() => {});
  }
});

test("real PostgreSQL posts one local balance under concurrent invoice retries", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyId = randomUUID();
  const locationId = randomUUID();
  const otherLocationId = randomUUID();
  const runId = randomUUID();
  const conflictingRunId = randomUUID();
  const authorityRunId = randomUUID();
  const cutoverRunId = randomUUID();
  const rollbackRunId = randomUUID();
  const lineId = randomUUID();
  const catalogPartId = randomUUID();
  const requestHash = createHash("sha256").update(`local-inventory-${suffix}`).digest("hex");
  const draft = {
    documentType: { value: "invoice", confidence: 100, evidence: "test" },
    vendorName: { value: "Integration Vendor", confidence: 100, evidence: "test" },
    vendorAccount: { value: "", confidence: 100, evidence: "" },
    invoiceNumber: { value: `INV-${suffix}`, confidence: 100, evidence: "test" },
    invoiceDate: { value: "2026-08-25", confidence: 100, evidence: "test" },
    purchaseOrderNumber: { value: "", confidence: 100, evidence: "" },
    currency: { value: "USD", confidence: 100, evidence: "test" },
    subtotal: { value: 20, confidence: 100, evidence: "test" },
    tax: { value: 0, confidence: 100, evidence: "test" },
    shipping: { value: 0, confidence: 100, evidence: "test" },
    total: { value: 20, confidence: 100, evidence: "test" },
    lines: [], warnings: [],
  };
  try {
    await query("insert into user_profiles (id, display_name) values ($1, $2)", [actorId, `Local inventory ${suffix}`]);
    await query("insert into companies (id, slug, name) values ($1, $2, $3)", [companyId, `local-inventory-${suffix}`, "Local inventory integration"]);
    await query(
      "insert into locations (id, company_id, name) values ($1, $2, $3), ($4, $2, $5)",
      [locationId, companyId, "Authorized shop", otherLocationId, "Other shop"],
    );
    await query(
      `insert into parts_catalog (
         id, company_id, normalized_part_number, part_number, description, uom_code
       ) values ($1, $2, $3, $4, 'Imported opening stock', 'ea')`,
      [catalogPartId, companyId, `FILTER${suffix}`, `FILTER-${suffix}`],
    );
    await query(
      `insert into inventory_items (
         company_id, location_id, catalog_part_id, normalized_part_number, part_number,
         description, quantity_on_hand, quantity_reserved, uom_code, source_provider, external_id
       ) values ($1, $2, $3, $4, $5, 'Imported opening stock', 5, 1, 'ea', 'local', $6)`,
      [companyId, locationId, catalogPartId, `FILTER${suffix}`, `FILTER-${suffix}`, `local-opening-${suffix}`],
    );
    await query(
      `insert into invoice_extraction_runs (
         id, company_id, location_id, created_by, reviewed_by, document_hash,
         file_name, mime_type, byte_size, idempotency_key, status, provider,
         model, prompt_version, reviewed_draft, reviewed_at
       ) values ($1, $2, $3, $4, $4, $5, $6, 'application/pdf', 1, $7,
         'reviewed', 'local-test', 'local-test', 'local-v1', $8, now())`,
      [runId, companyId, locationId, actorId, createHash("sha256").update(suffix).digest("hex"),
        "local-inventory.pdf", `extract-${suffix}`, JSON.stringify(draft)],
    );
    const lines = [{
      id: lineId,
      lineIndex: 0,
      normalizedPartNumber: `FILTER${suffix}`,
      partNumber: `FILTER-${suffix}`,
      description: "Integration filter",
      quantity: 2,
      uomCode: "ea",
      unitCost: 10,
      lineTotal: 20,
    }];
    const command = (receiptId) => postLocalInventoryReceipt({
      receiptId,
      runId,
      actorId,
      companyIds: [companyId],
      locationIds: [locationId],
      isAdmin: false,
      idempotencyKey: `post-${suffix}`,
      requestHash,
      reviewedRunVersion: 1,
      physicalConfirmation: "all_received_undamaged",
      confirmationHash: requestHash,
      labelBatchId: randomUUID(),
      lines: lines.map((line) => ({
        ...line,
        serializedUnits: [1, 2].map((ordinal) => ({
          id: randomUUID(),
          ordinal,
          serialNumber: `WG-L-${receiptId.replaceAll("-", "").slice(0, 16).toUpperCase()}-1-${ordinal}`,
        })),
      })),
    });
    const results = await Promise.all([command(randomUUID()), command(randomUUID())]);
    assert.deepEqual(results.map((result) => result.kind).sort(), ["posted", "replay"]);
    const counts = await query(
      `select
         (select count(*)::integer from local_inventory_receipts where company_id = $1 and invoice_run_id = $2) as receipts,
         (select count(*)::integer from inventory_stock_movements where company_id = $1 and receipt_id in (
           select id from local_inventory_receipts where company_id = $1 and invoice_run_id = $2
         )) as movements,
         (select count(*)::integer from inventory_serialized_units where company_id = $1 and receipt_id in (
           select id from local_inventory_receipts where company_id = $1 and invoice_run_id = $2
         )) as units,
         (select quantity_on_hand from inventory_items where company_id = $1 and location_id = $3
           and normalized_part_number = $4 and uom_code = 'ea') as on_hand`,
      [companyId, runId, locationId, `FILTER${suffix}`],
    );
    assert.deepEqual(counts.rows[0], { receipts: 1, movements: 1, units: 2, on_hand: "7.000" });
    const serializedLine = await query(
      `select generic.id = local.id as identity_preserved, generic.tracking_mode
       from local_inventory_receipt_lines local
       join inventory_receipt_lines generic
         on generic.company_id = local.company_id and generic.id = local.id
       where local.company_id = $1 and local.receipt_id = $2`,
      [companyId, results.find((result) => result.kind === "posted").receipt.id],
    );
    assert.deepEqual(serializedLine.rows[0], { identity_preserved: true, tracking_mode: "serial" });
    const balance = await query(
      `select quantity_reserved, source_provider
       from inventory_items
       where company_id = $1 and location_id = $2 and normalized_part_number = $3 and uom_code = 'ea'`,
      [companyId, locationId, `FILTER${suffix}`],
    );
    assert.deepEqual(balance.rows[0], { quantity_reserved: "1.000", source_provider: "local" });
    await query(
      `insert into invoice_extraction_runs (
         id, company_id, location_id, created_by, reviewed_by, document_hash,
         file_name, mime_type, byte_size, idempotency_key, status, provider,
         model, prompt_version, reviewed_draft, reviewed_at
       ) select input.id, company_id, location_id, created_by, reviewed_by, input.document_hash,
         input.file_name, mime_type, byte_size, input.idempotency_key, status, provider,
         model, prompt_version, reviewed_draft, reviewed_at
       from invoice_extraction_runs,
         (values ($1::uuid, $2::char(64), $3::text, $4::varchar),
                 ($5::uuid, $6::char(64), $7::text, $8::varchar),
                 ($9::uuid, $10::char(64), $11::text, $12::varchar))
           as input(id, document_hash, file_name, idempotency_key)
       where invoice_extraction_runs.id = $13`,
      [authorityRunId, createHash("sha256").update(`authority-${suffix}`).digest("hex"), "authority.pdf", `extract-authority-${suffix}`,
        cutoverRunId, createHash("sha256").update(`cutover-${suffix}`).digest("hex"), "cutover.pdf", `extract-cutover-${suffix}`,
        rollbackRunId, createHash("sha256").update(`rollback-${suffix}`).digest("hex"), "rollback.pdf", `extract-rollback-${suffix}`, runId],
    );
    await query(
      "update inventory_items set source_provider = 'odoo' where company_id = $1 and location_id = $2 and normalized_part_number = $3",
      [companyId, locationId, `FILTER${suffix}`],
    );
    const authorityConflict = await postLocalInventoryReceipt({
      receiptId: randomUUID(), runId: authorityRunId, actorId, companyIds: [companyId], locationIds: [locationId],
      isAdmin: false, idempotencyKey: `authority-${suffix}`, requestHash, reviewedRunVersion: 1,
      physicalConfirmation: "all_received_undamaged", confirmationHash: requestHash, labelBatchId: null,
      lines: [{ ...lines[0], id: randomUUID(), serializedUnits: [] }],
    });
    assert.equal(authorityConflict.kind, "authority_conflict");
    await query(
      `update inventory_items
       set source_provider = 'odoo', quantity_on_hand = 5, quantity_reserved = 0,
           external_id = $4, provider_updated_at = now()
       where company_id = $1 and location_id = $2 and normalized_part_number = $3`,
      [companyId, locationId, `FILTER${suffix}`, `odoo-opening-${suffix}`],
    );
    const cutover = await postLocalInventoryReceipt({
      receiptId: randomUUID(), runId: cutoverRunId, actorId, companyIds: [companyId], locationIds: [locationId],
      isAdmin: false, idempotencyKey: `cutover-${suffix}`, requestHash, reviewedRunVersion: 1,
      physicalConfirmation: "all_received_undamaged", confirmationHash: requestHash, labelBatchId: null,
      lines: [{ ...lines[0], id: randomUUID(), serializedUnits: [] }],
    });
    assert.equal(cutover.kind, "posted");
    const aggregateLine = await query(
      `select generic.id = movement.receipt_line_id as movement_identity,
              generic.tracking_mode, generic.quantity
       from inventory_receipt_lines generic
       join inventory_stock_movements movement
         on movement.company_id = generic.company_id
        and movement.receipt_line_id = generic.id
       where generic.company_id = $1 and generic.receipt_id = $2`,
      [companyId, cutover.receipt.id],
    );
    assert.deepEqual(aggregateLine.rows[0], {
      movement_identity: true,
      tracking_mode: "aggregate",
      quantity: 2,
    });
    const cutoverBalance = await query(
      `select quantity_on_hand, quantity_reserved, source_provider,
              provider_updated_at is null as provider_cleared,
              external_id like 'local:%' as local_identity
       from inventory_items
       where company_id = $1 and location_id = $2 and normalized_part_number = $3`,
      [companyId, locationId, `FILTER${suffix}`],
    );
    assert.deepEqual(cutoverBalance.rows[0], {
      quantity_on_hand: "2.000",
      quantity_reserved: "0.000",
      source_provider: "local",
      provider_cleared: true,
      local_identity: true,
    });
    const cutoverAudit = await query(
      `select previous_source_provider, previous_external_id,
              previous_quantity_on_hand, previous_quantity_reserved,
              previous_provider_updated_at is not null as provider_timestamp_preserved
       from inventory_authority_cutovers
       where company_id = $1 and receipt_id = $2`,
      [companyId, cutover.receipt.id],
    );
    assert.deepEqual(cutoverAudit.rows[0], {
      previous_source_provider: "odoo",
      previous_external_id: `odoo-opening-${suffix}`,
      previous_quantity_on_hand: "5.000",
      previous_quantity_reserved: "0.000",
      provider_timestamp_preserved: true,
    });
    await assert.rejects(
      postLocalInventoryReceipt({
        receiptId: randomUUID(), runId: rollbackRunId, actorId, companyIds: [companyId], locationIds: [locationId],
        isAdmin: false, idempotencyKey: `rollback-${suffix}`, requestHash, reviewedRunVersion: 1,
        physicalConfirmation: "all_received_undamaged", confirmationHash: requestHash, labelBatchId: randomUUID(),
        lines: [{ ...lines[0], id: randomUUID(), serializedUnits: [{ id: randomUUID(), ordinal: 1, serialNumber: `WG-L-${suffix.slice(0, 16).toUpperCase()}-2-1` }] }],
        createLabelBatch: async () => { throw new Error("synthetic label manifest failure"); },
      }),
      /synthetic label manifest failure/,
    );
    assert.equal(Number((await query(
      "select count(*) from local_inventory_receipts where company_id = $1 and invoice_run_id = $2",
      [companyId, rollbackRunId],
    )).rows[0].count), 0);
    await query(
      `insert into invoice_extraction_runs (
         id, company_id, location_id, created_by, reviewed_by, document_hash,
         file_name, mime_type, byte_size, idempotency_key, status, provider,
         model, prompt_version, reviewed_draft, reviewed_at
       ) select $1, company_id, location_id, created_by, reviewed_by, $2,
         'idempotency-conflict.pdf', mime_type, byte_size, $3, status, provider,
         model, prompt_version, reviewed_draft, reviewed_at
       from invoice_extraction_runs where id = $4`,
      [conflictingRunId, createHash("sha256").update(`conflict-${suffix}`).digest("hex"), `extract-conflict-${suffix}`, runId],
    );
    const conflictingReplay = await postLocalInventoryReceipt({
      receiptId: randomUUID(),
      runId: conflictingRunId,
      actorId,
      companyIds: [companyId],
      locationIds: [locationId],
      isAdmin: false,
      idempotencyKey: `post-${suffix}`,
      requestHash: createHash("sha256").update(`conflict-${suffix}`).digest("hex"),
      reviewedRunVersion: 1,
      physicalConfirmation: "all_received_undamaged",
      confirmationHash: createHash("sha256").update(`confirmation-${suffix}`).digest("hex"),
      labelBatchId: null,
      lines: [{ ...lines[0], id: randomUUID() }],
    });
    assert.equal(conflictingReplay.kind, "conflict");
    const otherLocationStock = await listLocalInventoryStock({
      companyIds: [companyId], locationIds: [otherLocationId], isAdmin: false,
      queryText: `FILTER-${suffix}`,
    });
    assert.equal(otherLocationStock.length, 1);
    assert.equal(otherLocationStock[0].quantityOnHand, 0);
    assert.equal(otherLocationStock[0].quantityAvailable, 0);
    assert.deepEqual(otherLocationStock[0].locations.map((location) => location.locationId), [otherLocationId]);
  } finally {
    await query("delete from inventory_authority_cutovers where company_id = $1", [companyId]).catch(() => {});
    await query("delete from inventory_label_batch_items where company_id = $1", [companyId]).catch(() => {});
    await query("delete from inventory_label_batches where company_id = $1", [companyId]).catch(() => {});
    await query("delete from inventory_unit_events where company_id = $1", [companyId]).catch(() => {});
    await query("delete from inventory_serialized_units where company_id = $1", [companyId]).catch(() => {});
    await query("delete from inventory_stock_movements where company_id = $1", [companyId]).catch(() => {});
    await query("delete from inventory_receipt_lines where company_id = $1", [companyId]).catch(() => {});
    await query("delete from inventory_receipts where company_id = $1", [companyId]).catch(() => {});
    await query("delete from local_inventory_receipt_lines where company_id = $1", [companyId]).catch(() => {});
    await query("delete from local_inventory_receipts where company_id = $1", [companyId]).catch(() => {});
    await query("delete from inventory_items where company_id = $1", [companyId]).catch(() => {});
    await query("delete from parts_catalog where company_id = $1", [companyId]).catch(() => {});
    await query("delete from invoice_extraction_runs where company_id = $1", [companyId]).catch(() => {});
    await query("delete from locations where company_id = $1", [companyId]).catch(() => {});
    await query("delete from companies where id = $1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id = $1", [actorId]).catch(() => {});
  }
});
