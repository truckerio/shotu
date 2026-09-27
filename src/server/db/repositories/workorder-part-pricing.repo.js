import { getPool } from "../pool.js";
import {
  calculateSellingUnitPrice,
  sellingPolicyCurrency,
} from "../../modules/inventory/inventory-selling-policy.js";
import { listAggregateUsageCostAllocations } from "./inventory-aggregate-cost-layers.repo.js";

const PRICE_SCALE = 10_000n;
const QUANTITY_SCALE = 1_000n;

function scaled(value, digits) {
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${digits}}))?$`).exec(String(value));
  if (!match) throw new TypeError("Invalid decimal value.");
  return BigInt(match[1]) * (10n ** BigInt(digits))
    + BigInt((match[2] || "").padEnd(digits, "0"));
}

function roundDivide(numerator, denominator) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}

function fixedFour(value) {
  return `${value / PRICE_SCALE}.${(value % PRICE_SCALE).toString().padStart(4, "0")}`;
}

function publicSnapshot(row, allocations = []) {
  return row && {
    id: row.id,
    selection: row.selection,
    unitPrice: String(row.unit_price),
    quantity: String(row.quantity),
    totalPrice: String(row.total_price),
    currency: row.currency,
    receiptLineId: row.receipt_line_id || null,
    sellingPolicyVersionId: row.selling_policy_version_id || null,
    allocations,
    createdAt: row.created_at,
  };
}

async function snapshotAllocations(client, companyId, snapshotId) {
  const result = await client.query(
    `select allocation.cost_layer_id,allocation.receipt_line_id,allocation.quantity,
            allocation.unit_price,allocation.total_price,allocation.currency,
            layer.source_kind,layer.received_at,
            coalesce(nullif(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{invoiceNumber,value}',''),
              receipt.provider_picking_name,receipt.provider_marker,'') receipt_reference
     from workorder_part_price_snapshot_allocations allocation
     join inventory_aggregate_cost_layers layer
       on layer.company_id=allocation.company_id and layer.id=allocation.cost_layer_id
     left join inventory_receipt_lines line
       on line.company_id=allocation.company_id and line.id=allocation.receipt_line_id
     left join inventory_receipts receipt
       on receipt.company_id=line.company_id and receipt.id=line.receipt_id
     left join invoice_extraction_runs run
       on run.company_id=receipt.company_id and run.id=receipt.invoice_run_id
     where allocation.company_id=$1 and allocation.snapshot_id=$2
     order by layer.received_at,layer.id`,
    [companyId, snapshotId],
  );
  return result.rows.map((allocation) => ({
    costLayerId: allocation.cost_layer_id,
    receiptLineId: allocation.receipt_line_id || null,
    sourceKind: allocation.source_kind,
    quantity: String(allocation.quantity),
    unitPrice: String(allocation.unit_price),
    totalPrice: String(allocation.total_price),
    currency: allocation.currency,
    receivedAt: allocation.received_at,
    receiptReference: allocation.receipt_reference || "",
  }));
}

export async function saveWorkorderPartPriceSnapshot(input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `workorder-part-price:${input.actorId}:${input.idempotencyKey}`,
    ]);
    const replay = await client.query(
      `select * from workorder_part_price_snapshots
       where company_id=any($1::uuid[]) and created_by=$2 and idempotency_key=$3
       limit 1`,
      [input.companyIds, input.actorId, input.idempotencyKey],
    );
    if (replay.rows[0]) {
      const allocations = await snapshotAllocations(client, replay.rows[0].company_id, replay.rows[0].id);
      await client.query("commit");
      return replay.rows[0].request_hash === input.requestHash
        ? { kind: "saved", snapshot: publicSnapshot(replay.rows[0], allocations), replayed: true }
        : { kind: "idempotency_conflict" };
    }

    const serialized = input.usageKind === "serialized";
    const usageTable = serialized
      ? "workorder_serialized_part_usages"
      : "workorder_aggregate_part_usages";
    const lineJoin = serialized
      ? `join inventory_serialized_units unit
           on unit.company_id=usage.company_id and unit.id=usage.unit_id
         join inventory_receipt_lines line
           on line.company_id=unit.company_id and line.id=unit.receipt_line_id`
      : "left join inventory_receipt_lines line on false";
    const selected = await client.query(
      `select usage.id usage_id,usage.company_id,usage.workorder_id,usage.catalog_part_id,
              ${serialized ? "1" : "usage.quantity+usage.adjustment_total"} quantity,
              workorder.status workorder_status,
              line.id receipt_line_id,line.unit_cost,line.currency batch_currency,
              policy.id policy_id,policy.method,policy.value policy_value,policy.currency policy_currency
       from ${usageTable} usage
       join operational_workorders workorder
         on workorder.company_id=usage.company_id and workorder.id=usage.workorder_id
       ${lineJoin}
       left join lateral (
         select candidate.*
         from inventory_part_selling_policy_versions candidate
         where candidate.company_id=usage.company_id
           and candidate.catalog_part_id=usage.catalog_part_id
           and (candidate.location_id is null or candidate.location_id=usage.location_id)
         order by (candidate.location_id is not null) desc,candidate.version desc
         limit 1
       ) policy on true
       where usage.id=$1 and usage.workorder_id=$2 and usage.company_id=any($3::uuid[])
         and ($5::boolean or usage.location_id=any($4::uuid[]))
       limit 1
       for update of usage,workorder`,
      [input.usageId, input.workorderId, input.companyIds, input.locationIds, input.isAdmin],
    );
    const row = selected.rows[0];
    if (!row) {
      await client.query("rollback");
      return { kind: "not_found" };
    }
    if (["closed", "odoo_entered", "cancelled"].includes(row.workorder_status)) {
      await client.query("rollback");
      return { kind: "locked" };
    }

    const costAllocations = serialized ? [] : await listAggregateUsageCostAllocations(client, {
      companyId: row.company_id,
      usageId: row.usage_id,
    });
    if (!serialized && !costAllocations.length) {
      await client.query("rollback");
      return { kind: "batch_cost_unavailable" };
    }

    let unitPrice;
    let totalPrice;
    let currency;
    let receiptLineId = null;
    let policyId = null;
    let pricedAllocations = [];
    if (serialized && input.selection === "batch_cost") {
      if (!row.receipt_line_id || row.unit_cost === null || !row.batch_currency) {
        await client.query("rollback");
        return { kind: "batch_cost_unavailable" };
      }
      unitPrice = String(row.unit_cost);
      currency = row.batch_currency;
      receiptLineId = row.receipt_line_id;
    } else if (serialized) {
      if (!row.policy_id) {
        await client.query("rollback");
        return { kind: "selling_policy_unavailable" };
      }
      try {
        unitPrice = calculateSellingUnitPrice(
          { method: row.method, value: row.policy_value, currency: row.policy_currency },
          row.unit_cost,
        );
        currency = sellingPolicyCurrency(
          { method: row.method, currency: row.policy_currency },
          row.batch_currency,
        );
      } catch {
        await client.query("rollback");
        return { kind: "batch_cost_unavailable" };
      }
      if (!currency) {
        await client.query("rollback");
        return { kind: "currency_unavailable" };
      }
      receiptLineId = row.receipt_line_id || null;
      policyId = row.policy_id;
    } else {
      if (input.selection === "selling_price" && !row.policy_id) {
        await client.query("rollback");
        return { kind: "selling_policy_unavailable" };
      }
      try {
        pricedAllocations = costAllocations.map((allocation) => {
          const allocationPrice = input.selection === "batch_cost"
            ? allocation.unitCost
            : calculateSellingUnitPrice(
              { method: row.method, value: row.policy_value, currency: row.policy_currency },
              allocation.unitCost,
            );
          const allocationCurrency = input.selection === "batch_cost"
            ? allocation.currency
            : sellingPolicyCurrency(
              { method: row.method, currency: row.policy_currency },
              allocation.currency,
            );
          if (allocationPrice === null || !allocationCurrency) throw new TypeError("Missing cost evidence.");
          const price = scaled(allocationPrice, 4);
          const quantity = scaled(allocation.quantity, 3);
          const total = roundDivide(price * quantity, QUANTITY_SCALE);
          return { ...allocation, unitPrice: fixedFour(price), totalPrice: fixedFour(total), currency: allocationCurrency };
        });
      } catch {
        await client.query("rollback");
        return { kind: "batch_cost_unavailable" };
      }
      const currencies = new Set(pricedAllocations.map((allocation) => allocation.currency));
      if (currencies.size !== 1) {
        await client.query("rollback");
        return { kind: "currency_unavailable" };
      }
      currency = pricedAllocations[0].currency;
      const total = pricedAllocations.reduce((sum, allocation) => sum + scaled(allocation.totalPrice, 4), 0n);
      const quantity = scaled(row.quantity, 3);
      unitPrice = fixedFour(roundDivide(total * QUANTITY_SCALE, quantity));
      totalPrice = fixedFour(total);
      policyId = input.selection === "selling_price" ? row.policy_id : null;
    }

    const quantity = String(row.quantity);
    totalPrice ||= fixedFour(roundDivide(scaled(unitPrice, 4) * scaled(quantity, 3), QUANTITY_SCALE));
    const saved = await client.query(
      `insert into workorder_part_price_snapshots(
         company_id,workorder_id,serialized_usage_id,aggregate_usage_id,selection,
         unit_price,quantity,total_price,currency,receipt_line_id,selling_policy_version_id,
         created_by,reason,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       returning *`,
      [
        row.company_id,
        row.workorder_id,
        serialized ? row.usage_id : null,
        serialized ? null : row.usage_id,
        input.selection,
        unitPrice,
        quantity,
        totalPrice,
        currency,
        receiptLineId,
        policyId,
        input.actorId,
        input.reason,
        input.idempotencyKey,
        input.requestHash,
      ],
    );
    for (const allocation of pricedAllocations) {
      await client.query(
        `insert into workorder_part_price_snapshot_allocations(
           company_id,snapshot_id,cost_layer_id,receipt_line_id,quantity,unit_price,total_price,currency
         ) values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [row.company_id, saved.rows[0].id, allocation.costLayerId, allocation.receiptLineId,
          allocation.quantity, allocation.unitPrice, allocation.totalPrice, allocation.currency],
      );
    }
    await client.query("commit");
    return { kind: "saved", snapshot: publicSnapshot(saved.rows[0], pricedAllocations), replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
