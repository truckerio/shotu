import { query } from "../db/pool.js";

function normalizedText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function normalizedUom(value) {
  return normalizedText(value || "pc");
}

function duplicateKey(part) {
  return [
    normalizedText(part?.partNo || part?.partNumber),
    normalizedUom(part?.uomCode),
    normalizedText(part?.repairOrder),
  ].join("\u0000");
}

function positiveQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

export function mergeOfficialWorkorderParts(manualParts = [], serializedParts = [], aggregateParts = []) {
  const serialized = (Array.isArray(serializedParts) ? serializedParts : []).map((part) => ({
    usageId: part.usageId,
    catalogPartId: part.catalogPartId,
    partNo: String(part.partNo || part.partNumber || "").trim(),
    serialNumber: String(part.serialNumber || "").trim(),
    qty: "1",
    uomCode: part.uomCode,
    repairOrder: String(part.repairOrder || "").trim(),
  }));
  const aggregate = (Array.isArray(aggregateParts) ? aggregateParts : []).map((part) => ({
    aggregateUsageId: part.aggregateUsageId || part.usageId,
    evidenceId: part.evidenceId,
    catalogPartId: part.catalogPartId,
    partNo: String(part.partNo || part.partNumber || "").trim(),
    qty: String(part.effectiveQuantity ?? part.qty ?? ""),
    uomCode: part.uomCode,
    repairOrder: String(part.repairOrder || "").trim(),
  }));
  const remainingByKey = new Map();
  for (const part of [...serialized, ...aggregate]) {
    const key = duplicateKey(part);
    remainingByKey.set(key, (remainingByKey.get(key) || 0) + positiveQuantity(part.qty));
  }
  const manual = (Array.isArray(manualParts) ? manualParts : []).filter((part) => {
    const key = duplicateKey(part);
    const remaining = remainingByKey.get(key) || 0;
    const quantity = positiveQuantity(part?.qty);
    if (!remaining || !quantity || quantity - remaining > 0.0005) return true;
    remainingByKey.set(key, Math.max(0, remaining - quantity));
    return false;
  });
  return [...serialized, ...aggregate, ...manual];
}

export async function listOfficialInstalledSerializedParts({
  workorderId,
  companyId,
  locationId,
  limit = 2000,
}, dependencies = {}) {
  const projection = await listOfficialWorkorderInventoryParts({ workorderId, companyId, locationId, limit }, dependencies);
  return projection.serializedParts;
}

export async function listOfficialConsumedAggregateParts({
  workorderId,
  companyId,
  locationId,
  limit = 2000,
}, dependencies = {}) {
  const projection = await listOfficialWorkorderInventoryParts({ workorderId, companyId, locationId, limit }, dependencies);
  return projection.aggregateParts;
}

export async function listOfficialWorkorderInventoryParts({
  workorderId,
  companyId,
  locationId,
  limit = 2000,
}, dependencies = {}) {
  const runQuery = dependencies.query || query;
  const result = await runQuery(
    `with serialized as (
       select 'serialized'::text as inventory_kind, usage.id as usage_id,
              null::uuid as evidence_id, usage.catalog_part_id, 1::numeric as effective_quantity,
              unit.serial_number, line.part_number, usage.uom_code, usage.repair_order,
              usage.finalized_at as occurred_at, usage.issued_at as created_at
         from workorder_serialized_part_usages usage
         join inventory_serialized_units unit
           on unit.company_id = usage.company_id and unit.id = usage.unit_id
         join inventory_receipt_lines line
           on line.company_id = unit.company_id and line.id = unit.receipt_line_id
        where usage.workorder_id = $1 and usage.company_id = $2 and usage.location_id = $3
          and usage.status = 'installed'
        order by usage.finalized_at, usage.issued_at, usage.id limit $4
     ), aggregate as (
       select 'aggregate'::text as inventory_kind, usage.id as usage_id,
              usage.evidence_id, usage.catalog_part_id,
              usage.quantity + usage.adjustment_total as effective_quantity,
              null::text as serial_number, catalog.part_number, usage.uom_code, usage.repair_order,
              usage.consumed_at as occurred_at, usage.created_at
         from workorder_aggregate_part_usages usage
         join parts_catalog catalog
           on catalog.company_id = usage.company_id and catalog.id = usage.catalog_part_id
        where usage.workorder_id = $1 and usage.company_id = $2 and usage.location_id = $3
          and usage.status = 'consumed'
        order by usage.consumed_at, usage.created_at, usage.id limit $4
     )
     select * from serialized union all select * from aggregate
     order by occurred_at, created_at, usage_id`,
    [workorderId, companyId, locationId, limit],
  );
  const serializedParts = result.rows.filter((row) => row.inventory_kind === "serialized").map((row) => ({
    usageId: row.usage_id,
    catalogPartId: row.catalog_part_id,
    partNumber: row.part_number,
    partNo: row.part_number,
    serialNumber: row.serial_number,
    qty: "1",
    uomCode: row.uom_code,
    repairOrder: row.repair_order || "",
  }));
  const aggregateParts = result.rows.filter((row) => row.inventory_kind === "aggregate").map((row) => ({
    aggregateUsageId: row.usage_id,
    evidenceId: row.evidence_id,
    catalogPartId: row.catalog_part_id,
    partNumber: row.part_number,
    partNo: row.part_number,
    effectiveQuantity: Number(row.effective_quantity),
    qty: String(row.effective_quantity),
    uomCode: row.uom_code,
    repairOrder: row.repair_order || "",
  }));
  return { serializedParts, aggregateParts };
}
