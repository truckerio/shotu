import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  applyInventoryCountImport,
  auditInventoryCountFileDownload,
  createInventoryCountImport,
  deleteExpiredInventoryCountSources,
  getInventoryCountImportFile,
  resolveInventoryCountImportLine,
} from "../../db/repositories/inventory-count-imports.repo.js";
import { closePool, query } from "../../db/pool.js";
import { encryptInventoryCountFile } from "./inventory-count-file.js";

const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === "1";

after(async () => {
  if (runPostgres) await closePool();
});

function sourceEvidence(seed, companyId, importId) {
  const bytes = Buffer.from(`xlsx-${seed}`);
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const sourceContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return {
    sourceFileName: `${seed}.xlsx`,
    sourceContentType,
    sourceSizeBytes: bytes.length,
    sourceSha256,
    sourceRetentionUntil: new Date(Date.now() + 86_400_000).toISOString(),
    encryptedSource: encryptInventoryCountFile(bytes, {
      companyId,
      importId,
      sourceSha256,
      contentType: sourceContentType,
      sizeBytes: bytes.length,
    }, { key: Buffer.alloc(32, 7).toString("base64"), keyVersion: "integration-v1" }),
  };
}

function countRow(sourceRow, partNumber, normalizedPartNumber, quantity, binLocation) {
  return {
    sourceRow,
    partNumber,
    normalizedPartNumber,
    partName: partNumber,
    description: "",
    binLocation,
    quantityText: String(quantity),
    quantity,
    averageCost: null,
  };
}

async function reviewAll(importValue, { actorId, companyId, locationId, targetPositionId }) {
  let current = importValue;
  for (const line of current.lines.filter((entry) => entry.matchStatus === "position_required")) {
    const result = await resolveInventoryCountImportLine({
      importId: current.id, lineId: line.id, actorId, companyIds: [companyId], locationIds: [locationId],
      expectedVersion: current.version, action: "match", catalogPartId: line.catalogPartId,
      quantity: line.quantity, binLocation: line.sourceBinLocation || "", targetPositionId,
    });
    assert.equal(result.kind, "updated");
    current = result.import;
  }
  return current;
}


test("migrations 164 and 165 preserve applied history and return legacy ready rows to destination review", { skip: !runPostgres }, async () => {
  const schema = `qa_count_migration_${randomUUID().replaceAll("-", "")}`;
  const client = await (await import("../../db/pool.js")).getPool().connect();
  try {
    await client.query(`create schema ${schema}`);
    await client.query(`set search_path to ${schema}, public`);
    await client.query(`create table inventory_positions(
      id uuid not null, company_id uuid not null, location_id uuid not null, system_key text,
      unique(company_id,id));
      create table inventory_count_imports(
        id uuid not null,company_id uuid not null,location_id uuid not null,status text not null,
        row_count integer not null,ready_count integer not null,exception_count integer not null,
        applied_count integer not null,version integer not null,updated_at timestamptz not null default now(),applied_at timestamptz,
        unique(company_id,id));
      create table inventory_count_import_lines(
        id uuid not null,company_id uuid not null,import_id uuid not null,source_row integer not null,
        catalog_part_id uuid,quantity integer,match_status text not null,updated_at timestamptz not null default now(),
        constraint inventory_count_import_lines_quantity_check check(quantity is null or quantity between 1 and 500),
        constraint inventory_count_import_lines_match_status_check check(match_status in('ready','unmatched','duplicate','invalid_quantity','ignored','applied')),
        constraint inventory_count_import_lines_match_state check((match_status in('ready','applied') and catalog_part_id is not null and quantity is not null) or match_status not in('ready','applied')));`);
    const companyId=randomUUID(),draftLocation=randomUUID(),appliedLocation=randomUUID(),draftImport=randomUUID(),appliedImport=randomUUID(),partId=randomUUID(),draftSystemPosition=randomUUID(),systemPosition=randomUUID();
    await client.query(`insert into inventory_positions values($1,$3,$4,'unassigned'),($2,$3,$5,'unassigned')`,[draftSystemPosition,systemPosition,companyId,draftLocation,appliedLocation]);
    await client.query(`insert into inventory_count_imports values
      ($1,$3,$4,'draft',2,1,1,0,1,now(),null),
      ($2,$3,$5,'applied',1,0,0,1,1,now(),now())`,[draftImport,appliedImport,companyId,draftLocation,appliedLocation]);
    await client.query(`insert into inventory_count_import_lines(id,company_id,import_id,source_row,catalog_part_id,quantity,match_status) values
      ($1,$4,$5,4,$7,2,'ready'),($2,$4,$5,5,null,null,'unmatched'),($3,$4,$6,4,$7,3,'applied')`,
      [randomUUID(),randomUUID(),randomUUID(),companyId,draftImport,appliedImport,partId]);
    const migration164=await readFile(new URL("../../db/migrations/164_inventory_count_import_position_precision.sql",import.meta.url),"utf8");
    const migration165=await readFile(new URL("../../db/migrations/165_inventory_count_import_legacy_precision_fix.sql",import.meta.url),"utf8");
    await client.query(migration164);
    await client.query(migration165);
    const lines=await client.query(`select import_id,source_row,catalog_part_id,quantity,target_position_id,match_status from inventory_count_import_lines order by import_id,source_row`);
    const ready=lines.rows.find(row=>row.import_id===draftImport&&row.source_row===4),unmatched=lines.rows.find(row=>row.import_id===draftImport&&row.source_row===5),applied=lines.rows.find(row=>row.import_id===appliedImport);
    assert.deepEqual({status:ready.match_status,catalogPartId:ready.catalog_part_id,quantity:ready.quantity,target:ready.target_position_id},{status:"position_required",catalogPartId:partId,quantity:"2.000",target:null});
    assert.equal(unmatched.match_status,"unmatched");
    assert.deepEqual({status:applied.match_status,target:applied.target_position_id,quantity:applied.quantity},{status:"applied",target:systemPosition,quantity:"3.000"});
    const imports=await client.query(`select id,status,ready_count,exception_count,applied_count,version from inventory_count_imports order by id`);
    const draft=imports.rows.find(row=>row.id===draftImport),history=imports.rows.find(row=>row.id===appliedImport);
    assert.deepEqual(draft,{id:draftImport,status:"draft",ready_count:0,exception_count:2,applied_count:0,version:2});
    assert.deepEqual(history,{id:appliedImport,status:"applied",ready_count:0,exception_count:0,applied_count:1,version:2});
  } finally {
    await client.query("set search_path to public").catch(()=>{});
    await client.query(`drop schema if exists ${schema} cascade`).catch(()=>{});
    client.release();
  }
});

test("real PostgreSQL batches an unbounded count apply, preserves evidence, and separates Odoo reference balances", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyId = randomUUID();
  const locationId = randomUUID();
  const targetPositionId = randomUUID();
  const inactivePositionId = randomUUID();
  const systemPositionId = randomUUID();
  const otherLocationId = randomUUID();
  const crossShopPositionId = randomUUID();
  const partA = randomUUID();
  const partB = randomUUID();
  const partC = randomUUID();
  const partD = randomUUID();
  const partE = randomUUID();
  const partF = randomUUID();
  const partG = randomUUID();
  const measuredPart = randomUUID();
  const rollbackPart = randomUUID();
  const quantityPart = randomUUID();
  const unreviewedPart = randomUUID();
  const importA = randomUUID();
  const importBatched = randomUUID();
  const importOdoo = randomUUID();
  const importUnreviewed = randomUUID();
  const importMeasured = randomUUID();
  const importRollback = randomUUID();
  const importQuantityInvalid = randomUUID();
  const importMeasuredInvalid = randomUUID();
  const numberA = `COUNT-A-${suffix}`;
  const numberB = `COUNT-B-${suffix}`;
  const numberC = `COUNT-C-${suffix}`;
  const numberD = `COUNT-D-${suffix}`;
  const normalizedA = `COUNTA${suffix}`;
  const normalizedB = `COUNTB${suffix}`;
  const normalizedC = `COUNTC${suffix}`;
  const normalizedD = `COUNTD${suffix}`;
  const catalogParts = [
    [partA, normalizedA, numberA, "A"],
    [partB, normalizedB, numberB, "B"],
    [partC, normalizedC, numberC, "C"],
    [partD, normalizedD, numberD, "D"],
    [partE, `COUNTE${suffix}`, `COUNT-E-${suffix}`, "E"],
    [partF, `COUNTF${suffix}`, `COUNT-F-${suffix}`, "F"],
    [partG, `COUNTG${suffix}`, `COUNT-G-${suffix}`, "G"],
  ];
  try {
    await query("insert into user_profiles (id, display_name) values ($1, $2)", [actorId, `Count integration ${suffix}`]);
    await query("insert into companies (id, slug, name) values ($1, $2, $3)", [companyId, `count-${suffix}`, "Count integration"]);
    await query("insert into locations (id, company_id, name) values ($1, $2, 'Count shop')", [locationId, companyId]);
    await query("insert into locations (id, company_id, name) values ($1, $2, 'Other shop')", [otherLocationId, companyId]);
    await query(`insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,created_by)
      values($1,$2,$3,'A1-B1','Aisle 1 / Bin 1','bin','storage',true,true,$4)`, [targetPositionId, companyId, locationId, actorId]);
    await query(`insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,system_key,created_by)
      values($1,$2,$3,'SYS-UNASSIGNED','Unassigned','area','unassigned',true,true,'unassigned',$4)`, [systemPositionId, companyId, locationId, actorId]);
    await query(`insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,is_active,created_by)
      values($1,$2,$3,'OLD-BIN','Old bin','bin','storage',true,true,false,$4)`, [inactivePositionId, companyId, locationId, actorId]);
    await query(`insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,created_by)
      values($1,$2,$3,'CROSS-BIN','Cross shop bin','bin','storage',true,true,$4)`, [crossShopPositionId, companyId, otherLocationId, actorId]);
    await query(
      `insert into parts_catalog (id, company_id, normalized_part_number, part_number, description, uom_code, tracking_mode)
       select input.id, $1, input.normalized_part_number, input.part_number, input.description, 'ea', 'serialized'
       from jsonb_to_recordset($2::jsonb) as input(
         id uuid, normalized_part_number text, part_number text, description text
       )`,
      [companyId, JSON.stringify(catalogParts.map(([id, normalizedPartNumber, partNumber, description]) => ({
        id,
        normalized_part_number: normalizedPartNumber,
        part_number: partNumber,
        description,
      })))],
    );
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
      values($1,$4,$5,$6,'Measured labor','hr','measured_bulk'),($2,$4,$7,$8,'Rollback serial','ea','serialized'),($3,$4,$9,$10,'Quantity each','ea','quantity')`,
      [measuredPart, rollbackPart, quantityPart, companyId, `MEASURED${suffix}`, `MEASURED-${suffix}`, `ROLLBACK${suffix}`, `ROLLBACK-${suffix}`, `QUANTITY${suffix}`, `QUANTITY-${suffix}`]);
    const unreviewedNumber = `COUNT-UNREVIEWED-${suffix}`;
    const unreviewedNormalized = `COUNTUNREVIEWED${suffix}`;
    await query(
      `insert into parts_catalog (id, company_id, normalized_part_number, part_number, description, uom_code, tracking_mode)
       values ($1, $2, $3, $4, 'Unreviewed count part', 'ea', null)`,
      [unreviewedPart, companyId, unreviewedNormalized, unreviewedNumber],
    );
    const unreviewed = await createInventoryCountImport({
      importId: importUnreviewed,
      companyIds: [companyId],
      locationIds: [locationId],
      actorId,
      locationId,
      ...sourceEvidence(`unreviewed-${suffix}`, companyId, importUnreviewed),
      rows: [countRow(4, unreviewedNumber, unreviewedNormalized, 2, "U1")],
    });
    assert.equal(unreviewed.import.lines[0].matchStatus, "unmatched");
    assert.equal(unreviewed.import.lines[0].catalogPartId, null);
    const refusedMatch = await resolveInventoryCountImportLine({
      importId: importUnreviewed,
      lineId: unreviewed.import.lines[0].id,
      actorId,
      companyIds: [companyId],
      locationIds: [locationId],
      expectedVersion: unreviewed.import.version,
      action: "match",
      catalogPartId: unreviewedPart,
      quantity: 2,
      binLocation: "U1",
      targetPositionId,
    });
    assert.equal(refusedMatch.kind, "tracking_required");

    const created = await createInventoryCountImport({
      importId: importA,
      companyIds: [companyId],
      locationIds: [locationId],
      actorId,
      locationId,
      ...sourceEvidence(`success-${suffix}`, companyId, importA),
      rows: [countRow(4, numberA, normalizedA, 5, "SOURCE-A1")],
    });
    assert.equal(created.kind, "created");
    const line = created.import.lines[0];
    assert.equal(line.sourceBinLocation, "SOURCE-A1");
    const reviewed = await resolveInventoryCountImportLine({
      importId: importA,
      lineId: line.id,
      actorId,
      companyIds: [companyId],
      locationIds: [locationId],
      expectedVersion: created.import.version,
      action: "match",
      catalogPartId: partA,
      quantity: 5,
      binLocation: "REVIEWED-B2",
      targetPositionId,
    });
    assert.equal(reviewed.import.lines[0].sourceBinLocation, "SOURCE-A1");
    assert.equal(reviewed.import.lines[0].binLocation, "REVIEWED-B2");
    const reviewAudit = await query(
      `select action, before_state, after_state from inventory_count_review_events
       where company_id=$1 and import_id=$2 and line_id=$3`,
      [companyId, importA, line.id],
    );
    assert.deepEqual(reviewAudit.rows, [{
      action: "match",
      before_state: {
        catalogPartId: partA,
        quantity: 5,
        reviewedBinLocation: "SOURCE-A1",
        targetPositionId: null,
        matchStatus: "position_required",
      },
      after_state: {
        catalogPartId: partA,
        quantity: 5,
        reviewedBinLocation: "REVIEWED-B2",
        targetPositionId,
        matchStatus: "ready",
      },
    }]);
    const applied = await applyInventoryCountImport({
      importId: importA,
      companyIds: [companyId],
      locationIds: [locationId],
      actorId,
      expectedVersion: reviewed.import.version,
    });
    assert.equal(applied.kind, "applied");
    const successEvidence = await query(
      `select
         (select count(*)::integer from inventory_serialized_units unit
          join inventory_receipts receipt on receipt.company_id=unit.company_id and receipt.id=unit.receipt_id
          where receipt.company_id=$1 and receipt.count_import_id=$2) as units,
         (select bin_location from inventory_items where company_id=$1 and location_id=$3 and catalog_part_id=$4) as bin_location`,
      [companyId, importA, locationId, partA],
    );
    assert.deepEqual(successEvidence.rows[0], { units: 5, bin_location: "REVIEWED-B2" });

    const batched = await createInventoryCountImport({
      importId: importBatched,
      companyIds: [companyId],
      locationIds: [locationId],
      actorId,
      locationId,
      ...sourceEvidence(`batched-${suffix}`, companyId, importBatched),
      rows: [
        countRow(4, numberC, normalizedC, 500, "C1"),
        countRow(5, numberD, normalizedD, 500, "D1"),
        countRow(6, catalogParts[4][2], catalogParts[4][1], 500, "E1"),
        countRow(7, catalogParts[5][2], catalogParts[5][1], 500, "F1"),
        countRow(8, catalogParts[6][2], catalogParts[6][1], 1, "G1"),
      ],
    });
    const reviewedBatched = await reviewAll(batched.import, { actorId, companyId, locationId, targetPositionId });
    const batchedApply = await applyInventoryCountImport({
      importId: importBatched,
      companyIds: [companyId],
      locationIds: [locationId],
      actorId,
      expectedVersion: reviewedBatched.version,
    });
    assert.equal(batchedApply.kind, "applied");
    const batchingEvidence = await query(
      `select
         (select count(*)::integer from inventory_receipts
          where company_id=$1 and count_import_id=$2) as receipts,
         (select count(*)::integer from inventory_label_batches batch
          join inventory_receipts receipt on receipt.company_id=batch.company_id and receipt.id=batch.receipt_id
          where receipt.company_id=$1 and receipt.count_import_id=$2) as label_batches,
         (select count(*)::integer from inventory_serialized_units unit
          join inventory_receipts receipt on receipt.company_id=unit.company_id and receipt.id=unit.receipt_id
          where receipt.company_id=$1 and receipt.count_import_id=$2) as units,
         (select max(receipt_units.units)::integer from (
            select sum(line.quantity)::integer as units
            from inventory_receipts receipt
            join inventory_receipt_lines line on line.company_id=receipt.company_id and line.receipt_id=receipt.id
            where receipt.company_id=$1 and receipt.count_import_id=$2
            group by receipt.id
          ) receipt_units) as max_batch_units`,
      [companyId, importBatched],
    );
    assert.deepEqual(batchingEvidence.rows[0], {
      receipts: 5,
      label_batches: 5,
      units: 2_001,
      max_batch_units: 500,
    });

    await query(
      `insert into odoo_product_mappings (company_id, external_id, catalog_part_id, default_code, display_name)
       values ($1, $2, $3, $4, 'Odoo managed part')`,
      [companyId, `odoo-${suffix}`, partB, numberB],
    );
    await query(
      `insert into odoo_inventory_balances (
         company_id, location_id, catalog_part_id, normalized_part_number,
         part_number, description, quantity_on_hand, uom_code, external_id
       ) values ($1,$2,$3,$4,$5,'Odoo reference balance',7,'ea',$6)`,
      [companyId, locationId, partB, normalizedB, numberB, `odoo-balance-${suffix}`],
    );
    const odoo = await createInventoryCountImport({
      importId: importOdoo,
      companyIds: [companyId],
      locationIds: [locationId],
      actorId,
      locationId,
      ...sourceEvidence(`odoo-${suffix}`, companyId, importOdoo),
      rows: [countRow(4, numberB, normalizedB, 1, "O1")],
    });
    const reviewedOdoo = await reviewAll(odoo.import, { actorId, companyId, locationId, targetPositionId });
    const odooApply = await applyInventoryCountImport({
      importId: importOdoo,
      companyIds: [companyId],
      locationIds: [locationId],
      actorId,
      expectedVersion: reviewedOdoo.version,
    });
    assert.equal(odooApply.kind, "applied");
    const separatedAuthorityEvidence = await query(
      `select
         (select count(*)::integer from inventory_receipts
          where company_id=$1 and count_import_id=$2) as local_count_receipts,
         (select quantity_on_hand from inventory_items
          where company_id=$1 and location_id=$3 and catalog_part_id=$4 and source_provider='local') as local_quantity,
         (select quantity_on_hand from odoo_inventory_balances
          where company_id=$1 and location_id=$3 and catalog_part_id=$4) as odoo_quantity,
         (select count(*)::integer from inventory_authority_cutovers cutover
          join inventory_receipts receipt on receipt.company_id=cutover.company_id and receipt.id=cutover.receipt_id
          where cutover.company_id=$1 and receipt.count_import_id=$2
            and cutover.source_kind='odoo_balance') as authority_snapshots`,
      [companyId, importOdoo, locationId, partB],
    );
    assert.deepEqual(separatedAuthorityEvidence.rows[0], {
      local_count_receipts: 1,
      local_quantity: "1.000",
      odoo_quantity: "7.000",
      authority_snapshots: 1,
    });

    const quantityInvalid = await createInventoryCountImport({
      importId: importQuantityInvalid, companyIds: [companyId], locationIds: [locationId], actorId, locationId,
      ...sourceEvidence(`quantity-invalid-${suffix}`, companyId, importQuantityInvalid),
      rows: [countRow(4, `QUANTITY-${suffix}`, `QUANTITY${suffix}`, 1.125, "QTY")],
    });
    assert.equal(quantityInvalid.import.lines[0].matchStatus, "invalid_quantity");
    const measuredInvalid = await createInventoryCountImport({
      importId: importMeasuredInvalid, companyIds: [companyId], locationIds: [locationId], actorId, locationId,
      ...sourceEvidence(`measured-invalid-${suffix}`, companyId, importMeasuredInvalid),
      rows: [countRow(4, `MEASURED-${suffix}`, `MEASURED${suffix}`, 1.125, "MEASURED")],
    });
    assert.equal(measuredInvalid.import.lines[0].matchStatus, "invalid_quantity");

    const measured = await createInventoryCountImport({
      importId: importMeasured, companyIds: [companyId], locationIds: [locationId], actorId, locationId,
      ...sourceEvidence(`measured-${suffix}`, companyId, importMeasured),
      rows: [countRow(4, `MEASURED-${suffix}`, `MEASURED${suffix}`, 1.12, "SHEET-MEASURED")],
    });
    assert.equal(measured.import.lines[0].matchStatus, "position_required");
    for (const invalidPositionId of [inactivePositionId, crossShopPositionId, systemPositionId]) {
      const invalid = await resolveInventoryCountImportLine({
        importId: importMeasured, lineId: measured.import.lines[0].id, actorId,
        companyIds: [companyId], locationIds: [locationId], expectedVersion: measured.import.version,
        action: "match", catalogPartId: measuredPart, quantity: 1.12,
        binLocation: "SHEET-MEASURED", targetPositionId: invalidPositionId,
      });
      assert.equal(invalid.kind, "position_invalid");
    }
    const reviewedMeasured = await reviewAll(measured.import, { actorId, companyId, locationId, targetPositionId });
    await query("update inventory_count_import_lines set quantity=1.125 where company_id=$1 and import_id=$2", [companyId, importMeasured]);
    const stalePrecision = await applyInventoryCountImport({
      importId: importMeasured, companyIds: [companyId], locationIds: [locationId], actorId,
      expectedVersion: reviewedMeasured.version,
    });
    assert.equal(stalePrecision.kind, "quantity_invalid");
    const noMeasuredMutation = await query("select count(*)::integer count from inventory_items where company_id=$1 and catalog_part_id=$2", [companyId, measuredPart]);
    assert.equal(noMeasuredMutation.rows[0].count, 0);
    await query("update inventory_count_import_lines set quantity=1.12 where company_id=$1 and import_id=$2", [companyId, importMeasured]);
    const appliedMeasured = await applyInventoryCountImport({
      importId: importMeasured, companyIds: [companyId], locationIds: [locationId], actorId,
      expectedVersion: reviewedMeasured.version,
    });
    assert.equal(appliedMeasured.kind, "applied");
    const measuredEvidence = await query(`select item.quantity_on_hand,position.quantity,position.position_id
      from inventory_items item join inventory_position_balances position
        on position.company_id=item.company_id and position.inventory_item_id=item.id
      where item.company_id=$1 and item.catalog_part_id=$2`, [companyId, measuredPart]);
    assert.deepEqual(measuredEvidence.rows, [{ quantity_on_hand: "1.120", quantity: "1.120", position_id: targetPositionId }]);

    const rollback = await createInventoryCountImport({
      importId: importRollback, companyIds: [companyId], locationIds: [locationId], actorId, locationId,
      ...sourceEvidence(`rollback-${suffix}`, companyId, importRollback),
      rows: [countRow(4, `ROLLBACK-${suffix}`, `ROLLBACK${suffix}`, 2, "SHEET-ROLLBACK")],
    });
    const reviewedRollback = await reviewAll(rollback.import, { actorId, companyId, locationId, targetPositionId });
    await assert.rejects(applyInventoryCountImport({
      importId: importRollback, companyIds: [companyId], locationIds: [locationId], actorId,
      expectedVersion: reviewedRollback.version,
      createLabelBatch: async () => { throw new Error("injected label failure"); },
    }), /injected label failure/);
    const rollbackEvidence = await query(`select
      (select count(*)::integer from inventory_receipts where company_id=$1 and count_import_id=$2) receipts,
      (select count(*)::integer from inventory_stock_movements movement join inventory_receipts receipt
        on receipt.company_id=movement.company_id and receipt.id=movement.receipt_id
        where receipt.company_id=$1 and receipt.count_import_id=$2) movements,
      (select count(*)::integer from inventory_items where company_id=$1 and catalog_part_id=$3) items,
      (select match_status from inventory_count_import_lines where company_id=$1 and import_id=$2) line_status`,
      [companyId, importRollback, rollbackPart]);
    assert.deepEqual(rollbackEvidence.rows[0], { receipts: 0, movements: 0, items: 0, line_status: "ready" });
    const retryRollback = await applyInventoryCountImport({
      importId: importRollback, companyIds: [companyId], locationIds: [locationId], actorId,
      expectedVersion: reviewedRollback.version,
    });
    assert.equal(retryRollback.kind, "applied");

    const source = await getInventoryCountImportFile({
      importId: importBatched,
      companyIds: [companyId],
      locationIds: [locationId],
    });
    assert.equal(source.source_ciphertext.length, source.source_size_bytes);
    await auditInventoryCountFileDownload({ companyId, importId: importBatched, actorId });
    await query("update inventory_count_imports set source_retention_until=now()-interval '1 second' where company_id=$1 and id=$2", [companyId, importBatched]);
    assert.equal(await deleteExpiredInventoryCountSources({ limit: 10 }), 1);
    assert.equal(await getInventoryCountImportFile({
      importId: importBatched,
      companyIds: [companyId],
      locationIds: [locationId],
    }), null);
    const access = await query(
      "select action, count(*)::integer as count from inventory_count_source_access_events where company_id=$1 and import_id=$2 group by action order by action",
      [companyId, importBatched],
    );
    assert.deepEqual(access.rows, [
      { action: "download", count: 1 },
      { action: "retention_delete", count: 1 },
    ]);
  } finally {
    await query("delete from inventory_count_review_events where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_count_source_access_events where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_label_batch_items where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_label_batches where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_unit_events where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_serialized_units where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_stock_movements where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_authority_cutovers where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_count_import_lines where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_receipt_lines where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_receipts where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_count_imports where company_id=$1", [companyId]).catch(() => {});
    await query("delete from odoo_product_mappings where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_items where company_id=$1", [companyId]).catch(() => {});
    await query("delete from odoo_inventory_balances where company_id=$1", [companyId]).catch(() => {});
    await query("delete from parts_catalog where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_positions where company_id=$1", [companyId]).catch(() => {});
    await query("delete from locations where company_id=$1", [companyId]).catch(() => {});
    await query("delete from companies where id=$1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id=$1", [actorId]).catch(() => {});
  }
});
