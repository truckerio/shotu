import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
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

test("real PostgreSQL batches an unbounded count apply, preserves evidence, and separates Odoo reference balances", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyId = randomUUID();
  const locationId = randomUUID();
  const partA = randomUUID();
  const partB = randomUUID();
  const partC = randomUUID();
  const partD = randomUUID();
  const partE = randomUUID();
  const partF = randomUUID();
  const partG = randomUUID();
  const importA = randomUUID();
  const importBatched = randomUUID();
  const importOdoo = randomUUID();
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
    await query(
      `insert into parts_catalog (id, company_id, normalized_part_number, part_number, description, uom_code)
       select input.id, $1, input.normalized_part_number, input.part_number, input.description, 'ea'
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
        matchStatus: "ready",
      },
      after_state: {
        catalogPartId: partA,
        quantity: 5,
        reviewedBinLocation: "REVIEWED-B2",
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
    const batchedApply = await applyInventoryCountImport({
      importId: importBatched,
      companyIds: [companyId],
      locationIds: [locationId],
      actorId,
      expectedVersion: batched.import.version,
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
    const odooApply = await applyInventoryCountImport({
      importId: importOdoo,
      companyIds: [companyId],
      locationIds: [locationId],
      actorId,
      expectedVersion: odoo.import.version,
    });
    assert.equal(odooApply.kind, "applied");
    const separatedAuthorityEvidence = await query(
      `select
         (select count(*)::integer from inventory_receipts
          where company_id=$1 and count_import_id=$2) as local_count_receipts,
         (select quantity_on_hand from inventory_items
          where company_id=$1 and location_id=$3 and catalog_part_id=$4 and source_provider='local') as local_quantity,
         (select quantity_on_hand from odoo_inventory_balances
          where company_id=$1 and location_id=$3 and catalog_part_id=$4) as odoo_quantity`,
      [companyId, importOdoo, locationId, partB],
    );
    assert.deepEqual(separatedAuthorityEvidence.rows[0], {
      local_count_receipts: 1,
      local_quantity: "1.000",
      odoo_quantity: "7.000",
    });

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
    await query("delete from locations where company_id=$1", [companyId]).catch(() => {});
    await query("delete from companies where id=$1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id=$1", [actorId]).catch(() => {});
  }
});
