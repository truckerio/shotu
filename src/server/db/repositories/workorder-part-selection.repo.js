import { createHash } from "node:crypto";
import { getPool } from "../pool.js";
import { reserveAggregateWorkorderUsage } from "./inventory-aggregate-workorder-usage.repo.js";
import { issueSerializedUnitToWorkorder } from "./inventory-unit-workorder-usage.repo.js";
import { saveWorkorderPartPriceSnapshot } from "./workorder-part-pricing.repo.js";
import { readCreatePricing } from "./workorder-create-pricing.repo.js";
import { buildCandidatePricingPreview } from "../../modules/workorders/workorder-part-pricing.service.js";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function commitUsageAndPrice(input, createUsage, usageKind) {
  const client = await getPool().connect();
  try {
    await client.query("begin isolation level repeatable read");
    const replay = usageKind === "serialized" ? await client.query(
      `select id,issue_request_hash request_hash from workorder_serialized_part_usages
        where company_id=$1 and issued_by_user_id=$2 and issue_idempotency_key=$3 for update`,
      [input.usage.companyId, input.usage.actorId, input.usage.idempotencyKey],
    ) : await client.query(
      `select id,request_hash from workorder_aggregate_part_usages
        where company_id=any($1::uuid[]) and created_by_user_id=$2 and idempotency_key=$3 for update`,
      [input.usage.companyIds, input.usage.actorId, input.usage.idempotencyKey],
    );
    if (replay.rows[0]) {
      if (replay.rows[0].request_hash !== input.usage.requestHash) {
        await client.query("rollback"); return { kind: "idempotency_conflict" };
      }
      const usageReplay = await createUsage(input.usage, client);
      if (usageReplay.kind !== "replay") {
        await client.query("rollback"); return { kind: "idempotency_conflict" };
      }
      const priceIdempotencyKey = `${input.usage.idempotencyKey}:price`;
      const priceCommand = {
        workorderId: input.usage.workorderId, usageKind, usageId: replay.rows[0].id,
        selection: input.pricing.selection, expectedFingerprint: input.pricing.expectedFingerprint,
        reason: input.pricing.reason, actorId: input.usage.actorId,
        companyIds: input.usage.companyIds || [input.usage.companyId],
        locationIds: input.usage.locationIds || [input.usage.locationId],
        isAdmin: input.usage.isAdmin ?? input.usage.actorRole === "admin",
        idempotencyKey: priceIdempotencyKey,
      };
      const price = await saveWorkorderPartPriceSnapshot({ ...priceCommand, requestHash: hash(priceCommand) }, client);
      if (price.kind !== "saved" || !price.replayed) {
        await client.query("rollback"); return { kind: "pricing_changed" };
      }
      await client.query("commit");
      return { kind: "replay", usage: usageReplay.usage, price: price.snapshot };
    }
    const exact = usageKind === "serialized" ? (await client.query(
      `select workorder.company_id,workorder.location_id,line.catalog_part_id,line.uom_code
         from operational_workorders workorder
         join inventory_serialized_units unit on unit.company_id=workorder.company_id
           and unit.location_id=workorder.location_id and unit.id=$2
         join inventory_receipt_lines line on line.company_id=unit.company_id and line.id=unit.receipt_line_id
        where workorder.id=$1 and workorder.company_id=$3 and workorder.location_id=$4`,
      [input.usage.workorderId, input.usage.unitId, input.usage.companyId, input.usage.locationId],
    )).rows[0] : {
      company_id: input.usage.companyIds?.[0] || input.usage.companyId,
      location_id: input.usage.locationIds?.[0] || input.usage.locationId,
      catalog_part_id: input.usage.catalogPartId,
      uom_code: input.usage.uomCode,
    };
    if (!exact) { await client.query("rollback"); return { kind: "not_found" }; }
    const identity = usageKind === "serialized"
      ? { usageKind, unitId: input.usage.unitId, catalogPartId: exact.catalog_part_id, quantity: 1, uomCode: exact.uom_code }
      : { usageKind, sourcePositionId: input.usage.sourcePositionId, catalogPartId: exact.catalog_part_id,
        quantity: input.usage.quantity, uomCode: exact.uom_code };
    const preview = await readCreatePricing({
      companyId: exact.company_id, locationId: exact.location_id,
      formData: { parts: [{ catalogPartId: exact.catalog_part_id, qty: identity.quantity, uomCode: exact.uom_code }], laborHours: 0, laborProduct: null },
      inventoryUnitSelections: usageKind === "serialized" ? [{ partIndex: 0, unitIds: [input.usage.unitId] }] : [],
      inventoryPositionSelections: usageKind === "aggregate" ? [{ partIndex: 0, positionId: input.usage.sourcePositionId }] : [],
      pricing: { parts: [] },
    }, client);
    const current = buildCandidatePricingPreview(input.usage.workorderId, identity, preview.parts[0]?.options || {});
    if (current.fingerprint !== input.pricing.expectedFingerprint
      || current.options?.[input.pricing.selection]?.status !== "known") {
      await client.query("rollback");
      return { kind: "pricing_changed" };
    }
    const usageResult = await createUsage(input.usage, client);
    if (!["issued", "reserved", "replay"].includes(usageResult.kind)) {
      await client.query("rollback");
      return usageResult;
    }
    const priceIdempotencyKey = `${input.usage.idempotencyKey}:price`;
    const priceCommand = {
      workorderId: input.usage.workorderId,
      usageKind,
      usageId: usageResult.usage.id,
      selection: input.pricing.selection,
      expectedFingerprint: input.pricing.expectedFingerprint,
      reason: input.pricing.reason,
      actorId: input.usage.actorId,
      companyIds: input.usage.companyIds || [input.usage.companyId],
      locationIds: input.usage.locationIds || [input.usage.locationId],
      isAdmin: input.usage.isAdmin ?? input.usage.actorRole === "admin",
      idempotencyKey: priceIdempotencyKey,
    };
    const price = await saveWorkorderPartPriceSnapshot({
      ...priceCommand,
      requestHash: hash(priceCommand),
    }, client);
    if (price.kind !== "saved") {
      await client.query("rollback");
      return { kind: "pricing_changed", pricingKind: price.kind };
    }
    await client.query("commit");
    return { ...usageResult, price: price.snapshot };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function issueSerializedUnitWithPrice(input) {
  return commitUsageAndPrice(input, issueSerializedUnitToWorkorder, "serialized");
}

export function reserveAggregateUsageWithPrice(input) {
  return commitUsageAndPrice(input, reserveAggregateWorkorderUsage, "aggregate");
}
