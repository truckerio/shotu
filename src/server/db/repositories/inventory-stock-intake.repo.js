import { createHash, randomUUID } from "node:crypto";
import { getPool } from "../pool.js";
import { inspectInventoryAuthority, recordInventoryAuthorityCutover, recordInventoryAuthorityException } from "./inventory-authority.repo.js";
import { hasQuantityPrecision } from "../../modules/parts/quantity-uom.js";

const MEASURED_CATEGORIES = new Set(["liquid_volume", "mass", "gas_volume", "length"]);
const QUANTITY_CATEGORIES = new Set(["count", "packaging"]);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function postAggregateStockIntake(input) {
  const client = await getPool().connect();
  const requestHash = hash({ catalogPartId: input.catalogPartId, locationId: input.locationId, quantity: input.quantity,
    uomCode: input.uomCode, trackingMode: input.trackingMode, confirmation: input.confirmation });
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`stock-intake:${input.actorId}:${input.idempotencyKey}`]);
    const replay = await client.query(
      `select batch.*, receipt.id as receipt_id from inventory_manual_intake_batches batch
       join inventory_receipts receipt on receipt.company_id=batch.company_id and receipt.manual_intake_batch_id=batch.id
       where batch.company_id=any($1::uuid[]) and batch.created_by=$2 and batch.idempotency_key=$3
         and ($5::boolean or batch.location_id=any($4::uuid[])) limit 1`,
      [input.companyIds, input.actorId, input.idempotencyKey, input.locationIds, input.isAdmin],
    );
    if (replay.rows[0]) {
      await client.query("commit");
      return replay.rows[0].request_hash === requestHash
        ? { kind: "replay", receiptId: replay.rows[0].receipt_id, quantity: Number(replay.rows[0].quantity) }
        : { kind: "idempotency_conflict" };
    }
    const selected = await client.query(
      `select catalog.company_id,catalog.id,catalog.normalized_part_number,catalog.part_number,catalog.description,
              catalog.uom_code,catalog.tracking_mode,uom.category,uom.decimal_scale
       from parts_catalog catalog join units_of_measure uom on uom.code=catalog.uom_code
       join locations location on location.company_id=catalog.company_id and location.id=$2
       where catalog.id=$1 and catalog.company_id=any($3::uuid[])
         and ($5::boolean or location.id=any($4::uuid[])) limit 1 for update of catalog`,
      [input.catalogPartId, input.locationId, input.companyIds, input.locationIds, input.isAdmin],
    );
    const part = selected.rows[0];
    if (!part) { await client.query("rollback"); return { kind: "not_found" }; }
    if (part.tracking_mode !== input.trackingMode || !["quantity", "measured_bulk"].includes(part.tracking_mode)) {
      await client.query("rollback"); return { kind: "tracking_policy" };
    }
    if (part.uom_code !== input.uomCode) { await client.query("rollback"); return { kind: "uom_mismatch" }; }
    const quantityValid = part.tracking_mode === "quantity"
      ? QUANTITY_CATEGORIES.has(part.category) && Number(part.decimal_scale) === 0 && Number.isInteger(input.quantity)
      : MEASURED_CATEGORIES.has(part.category)
        && hasQuantityPrecision(input.quantity, Number(part.decimal_scale));
    if (!quantityValid) { await client.query("rollback"); return { kind: "unsupported_uom" }; }
    const authority = await inspectInventoryAuthority(client, { companyId: part.company_id, locationId: input.locationId,
      catalogPartId: part.id, normalizedPartNumber: part.normalized_part_number, uomCode: part.uom_code });
    if (authority.kind !== "claimable") {
      await recordInventoryAuthorityException(client, { claim: authority, companyId: part.company_id, locationId: input.locationId,
        catalogPartId: part.id, normalizedPartNumber: part.normalized_part_number, uomCode: part.uom_code });
      await client.query("commit");
      return { kind: authority.kind === "reservation_blocked" ? "authority_conflict" : "authority_unmatched" };
    }
    const batchId = randomUUID(); const receiptId = randomUUID(); const lineId = randomUUID();
    await client.query(`insert into inventory_manual_intake_batches
      (id,company_id,location_id,catalog_part_id,created_by,idempotency_key,request_hash,quantity,uom_code,tracking_mode,physical_confirmation)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [batchId, part.company_id, input.locationId, part.id, input.actorId, input.idempotencyKey, requestHash,
      input.quantity, part.uom_code, part.tracking_mode, input.confirmation]);
    await client.query(`insert into inventory_receipts
      (id,company_id,location_id,invoice_run_id,count_import_id,serialization_batch_id,manual_intake_batch_id,created_by,
       idempotency_key,provider,provider_marker,provider_picking_name,status,confirmed_at)
      values ($1,$2,$3,null,null,null,$4,$5,$6,'local_manual',$7,'Manual physical intake','confirmed',now())`,
    [receiptId, part.company_id, input.locationId, batchId, input.actorId, input.idempotencyKey, `MAN-${batchId}`]);
    await client.query(`insert into inventory_receipt_lines
      (id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode)
      values ($1,$2,$3,0,$4,$5,$6,$7,$8,$9,'aggregate')`,
    [lineId, part.company_id, receiptId, part.id, `local-manual:${part.id}`, part.part_number, part.description || "", input.quantity, part.uom_code]);
    await recordInventoryAuthorityCutover(client, { claim: authority, companyId: part.company_id, locationId: input.locationId,
      catalogPartId: part.id, receiptId, receiptLineId: lineId });
    const balance = await client.query(`insert into inventory_items
      (company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,
       uom_code,source_provider,external_id,last_seen_at,updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,0,$8,'local',$9,now(),now())
      on conflict (company_id,(coalesce(location_id,'00000000-0000-0000-0000-000000000000'::uuid)),normalized_part_number,uom_code)
      do update set catalog_part_id=excluded.catalog_part_id,part_number=excluded.part_number,description=excluded.description,
       quantity_on_hand=inventory_items.quantity_on_hand+excluded.quantity_on_hand,source_provider='local',updated_at=now()
      where inventory_items.source_provider='local' returning id`,
    [part.company_id, input.locationId, part.id, part.normalized_part_number, part.part_number, part.description || "",
      input.quantity, part.uom_code, `local:${part.id}:${input.locationId}:${part.uom_code}`]);
    if (!balance.rows[0]) throw Object.assign(new Error("Local inventory ownership changed during intake."), { code: "INVENTORY_AUTHORITY_CONFLICT" });
    await client.query(`insert into inventory_stock_movements
      (company_id,location_id,catalog_part_id,receipt_id,receipt_line_id,movement_type,quantity_delta,uom_code,actor_id,reason,idempotency_key)
      values ($1,$2,$3,$4,$5,'manual_receipt',$6,$7,$8,'Physical stock intake',$9)`,
    [part.company_id, input.locationId, part.id, receiptId, lineId, input.quantity, part.uom_code, input.actorId, `manual-intake:${batchId}`]);
    await client.query("commit");
    return { kind: "posted", receiptId, quantity: input.quantity };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error?.code === "INVENTORY_AUTHORITY_CONFLICT") return { kind: "authority_conflict" };
    if (error?.code === "23505") return { kind: "idempotency_conflict" };
    throw error;
  } finally { client.release(); }
}

export const stockIntakeInternals = { MEASURED_CATEGORIES, QUANTITY_CATEGORIES, hash };
