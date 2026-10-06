import { createHash } from "node:crypto";
import { getPool } from "../pool.js";
import { calculateSellingUnitPrice, sellingPolicyCurrency } from "../../modules/inventory/inventory-selling-policy.js";
import { workorderPricingSummary } from "../../modules/workorders/workorder-labor-pricing.service.js";
import { validLaborQuantity } from "../../../../shared/labor-product.js";
import { readEffectiveLaborPriceSources } from "./workorder-labor-price-sources.repo.js";

const fixed = (value) => `${value / 10000n}.${String(value % 10000n).padStart(4, "0")}`;
function scaled(value, digits) {
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${digits}}))?$`).exec(String(value));
  if (!match) throw new Error("Unknown price or invalid quantity.");
  return BigInt(match[1]) * 10n ** BigInt(digits) + BigInt((match[2] || "").padEnd(digits, "0"));
}
const divide = (a, b) => (a + b / 2n) / b;

export function priceCreateAllocations(allocations, selection, policy, quantity) {
  const priced = allocations.map((allocation) => {
    const unitPrice = selection === "batch_cost" ? allocation.unitCost : calculateSellingUnitPrice(policy, allocation.unitCost);
    const currency = selection === "batch_cost" ? allocation.currency : sellingPolicyCurrency(policy, allocation.currency);
    if (!currency) throw new Error("Unknown currency.");
    return { ...allocation, unitPrice: fixed(scaled(unitPrice, 4)), currency,
      totalPrice: fixed(divide(scaled(unitPrice, 4) * scaled(allocation.quantity, 3), 1000n)) };
  });
  if (!priced.length || new Set(priced.map((row) => row.currency)).size !== 1) throw new Error("Incomplete batch pricing.");
  const total = priced.reduce((sum, row) => sum + scaled(row.totalPrice, 4), 0n);
  return { selection, quantity: String(quantity), unitPrice: fixed(divide(total * 1000n, scaled(quantity, 3))),
    totalPrice: fixed(total), currency: priced[0].currency, allocations: priced,
    sellingPolicyVersionId: selection === "selling_price" ? policy?.id : null };
}

export function applyCreatePriceOverride(price, customUnitPrice) {
  if (!price || customUnitPrice === undefined) return price;
  const base = scaled(price.unitPrice, 4);
  const custom = scaled(customUnitPrice, 4);
  if (base === custom) return price;
  const quantity = scaled(price.quantity ?? price.hours, price.hours === undefined ? 3 : 2);
  const quantityScale = price.hours === undefined ? 1000n : 100n;
  return {
    ...price,
    baseUnitPrice: fixed(base),
    manualOverride: true,
    unitPrice: fixed(custom),
    totalPrice: fixed(divide(custom * quantity, quantityScale)),
  };
}

function priceEvidence(price) {
  if (!price) return null;
  return {
    selection: price.selection, quantity: scaled(price.quantity ?? price.hours, 3).toString(),
    uomCode: price.uomCode || (price.hours === undefined ? null : "hr"),
    unitPrice: scaled(price.unitPrice, 4).toString(), totalPrice: scaled(price.totalPrice, 4).toString(), currency: price.currency,
    baseUnitPrice: price.baseUnitPrice == null ? null : scaled(price.baseUnitPrice, 4).toString(),
    manualOverride: price.manualOverride === true,
    rateVersionId: price.rateVersionId || null, sellingPolicyVersionId: price.sellingPolicyVersionId || null,
    receiptLineId: price.receiptLineId || null,
    allocations: (price.allocations || []).map((row) => ({ costLayerId: row.costLayerId,
      receiptLineId: row.receiptLineId || null, quantity: scaled(row.quantity, 3).toString(),
      unitPrice: scaled(row.unitPrice, 4).toString(), totalPrice: scaled(row.totalPrice, 4).toString(), currency: row.currency })),
  };
}

export function createPricingFingerprint(input, parts, labor) {
  return createHash("sha256").update(JSON.stringify({
    companyId: input.companyId, locationId: input.locationId,
    formParts: (input.formData?.parts || []).map((row) => ({ catalogPartId: row.catalogPartId || null,
      quantity: String(row.qty), uomCode: row.uomCode || "ea", purchaseRequested: row.purchaseRequested === true })),
    units: input.inventoryUnitSelections || [], positions: input.inventoryPositionSelections || [],
    laborProductId: input.formData?.laborProduct?.productId || null,
    laborHours: String(input.formData?.laborHours || ""),
    laborUomCode: input.formData?.laborProduct?.uomCode || "hr",
    parts: [...parts].sort((a,b) => a.partIndex-b.partIndex).map((row) => ({ partIndex: row.partIndex, price: priceEvidence(row.price) })),
    labor: priceEvidence(labor?.price),
  })).digest("hex");
}

export async function readCreatePricing(input, transactionClient = null) {
  const client = transactionClient || await getPool().connect();
  try {
    if (!transactionClient) await client.query("begin isolation level repeatable read read only");
    const parts = [];
    const depleted = new Map();
    const layerCache = new Map();
    const selections = new Map((input.pricing?.parts || []).map((row) => [row.partIndex, row]));
    for (const [partIndex, sourcePart] of (input.formData.parts || []).entries()) {
      if (!sourcePart.catalogPartId || sourcePart.purchaseRequested) continue;
      const selected = selections.get(partIndex);
      const selection = selected || { partIndex, selection: "batch_cost" };
      const part = input.formData.parts[partIndex];
      const scope = [input.companyId, input.locationId, part.catalogPartId, part.uomCode || "ea"];
      const policy = (await client.query(`select * from inventory_part_selling_policy_versions
        where company_id=$1 and catalog_part_id=$3 and (location_id is null or location_id=$2)
        order by (location_id is not null) desc,version desc limit 1`, scope.slice(0, 3))).rows[0];
      const units = input.inventoryUnitSelections.find((row) => row.partIndex === partIndex);
      const position = input.inventoryPositionSelections.find((row) => row.partIndex === partIndex);
      let allocations = [];
      try {
        if (units) {
          const rows = (await client.query(`select unit.id,line.id receipt_line_id,line.unit_cost,line.currency
            from inventory_serialized_units unit join inventory_receipt_lines line
              on line.company_id=unit.company_id and line.id=unit.receipt_line_id
            join inventory_receipts receipt on receipt.company_id=unit.company_id and receipt.id=unit.receipt_id
            join inventory_positions position on position.company_id=unit.company_id
              and position.location_id=unit.location_id and position.id=unit.current_position_id
            where unit.company_id=$1 and unit.location_id=$2 and line.catalog_part_id=$3
              and unit.id=any($4::uuid[]) and unit.status='in_stock'
              and receipt.provider in ('local','local_count','local_serialization')
              and unit.custody_holder_type='inventory_location'
              and (unit.condition_code in ('new','serviceable_used','refurbished')
                or (unit.condition_code='unknown' and unit.custody_legacy_available))
              and position.is_active and position.can_store and position.is_pickable`,
          [scope[0], scope[1], scope[2], units.unitIds])).rows;
          if (rows.length !== 1 || units.unitIds.length !== 1) throw new Error("Selected unit is unavailable.");
          allocations = rows.map((row) => ({ receiptLineId: row.receipt_line_id, quantity: "1", unitCost: row.unit_cost, currency: row.currency }));
        } else if (position) {
          const cacheKey = scope.join(":");
          if (!layerCache.has(cacheKey)) layerCache.set(cacheKey, (await client.query(`select layer.*,
            coalesce(revision.unit_cost,line.unit_cost,layer.unit_cost) current_unit_cost,
            coalesce(revision.currency,line.currency,layer.currency) current_currency,
            coalesce((select jsonb_agg(jsonb_build_object('positionId',p.position_id,'available',p.quantity_on_hand-p.quantity_reserved))
              from inventory_aggregate_cost_layer_positions p where p.company_id=layer.company_id and p.cost_layer_id=layer.id
              and p.quantity_on_hand>0),'[]'::jsonb) placements
            from inventory_aggregate_cost_layers layer
            left join inventory_receipt_lines line on line.company_id=layer.company_id and line.id=layer.receipt_line_id
            left join lateral(select * from inventory_aggregate_cost_layer_revisions r where r.company_id=layer.company_id
              and r.cost_layer_id=layer.id order by r.version desc limit 1)revision on true
            where layer.company_id=$1 and layer.location_id=$2 and layer.catalog_part_id=$3 and layer.uom_code=$4
            order by layer.received_at,layer.id`, scope)).rows);
          const layers = layerCache.get(cacheKey);
          const hasPlacements = layers.some((row) => row.placements.length);
          let remaining = Number(part.qty);
          for (const layer of layers) {
            const placement = layer.placements.find((row) => row.positionId === position.positionId);
            const key = hasPlacements ? `${layer.id}:${position.positionId}` : layer.id;
            const available = Math.min(Number(layer.quantity_on_hand) - Number(layer.quantity_reserved) - (depleted.get(layer.id) || 0),
              hasPlacements ? Number(placement?.available || 0) - (depleted.get(key) || 0) : Infinity);
            const take = Math.min(remaining, Math.max(0, available));
            if (!take) continue;
            depleted.set(layer.id, (depleted.get(layer.id) || 0) + take);
            if (hasPlacements) depleted.set(key, (depleted.get(key) || 0) + take);
            allocations.push({ costLayerId: layer.id, receiptLineId: layer.receipt_line_id,
              quantity: take.toFixed(3), unitCost: layer.current_unit_cost, currency: layer.current_currency,
              sourceKind: layer.source_kind, receivedAt: layer.received_at });
            remaining = Number((remaining - take).toFixed(3));
            if (remaining <= 0) break;
          }
          if (remaining > 0) throw new Error("Exact batch quantity is unavailable at this pickup location.");
        } else throw new Error("Choose exact units or a pickup location.");
        const options = Object.fromEntries(["batch_cost", "selling_price"].map((priceSelection) => {
          try {
            const option = priceCreateAllocations(allocations, priceSelection, policy, part.qty);
            if (units) { option.receiptLineId = allocations[0].receiptLineId; option.allocations = []; }
            return [priceSelection, { status: "known", price: option }];
          } catch (error) {
            return [priceSelection, { status: "incomplete", price: null, reason: error.message }];
          }
        }));
        const selectedOption = selected ? options[selection.selection] : null;
        if (!selected) parts.push({ partIndex, status: "unselected", price: null, options });
        else if (selectedOption?.status === "known") parts.push({
          partIndex,
          status: "known",
          price: applyCreatePriceOverride(selectedOption.price, selection.customUnitPrice),
          options,
        });
        else parts.push({ partIndex, status: "incomplete", price: null, reason: selectedOption?.reason || "Price unavailable.", options });
      } catch (error) {
        const options = {
          batch_cost: { status: "incomplete", price: null, reason: error.message },
          selling_price: { status: "incomplete", price: null, reason: error.message },
        };
        parts.push({ partIndex, status: selected ? "incomplete" : "unselected", price: null, reason: error.message, options });
      }
    }
    const rates = await readEffectiveLaborPriceSources({ companyId: input.companyId, locationId: input.locationId,
      productId: input.formData?.laborProduct?.productId }, (sql, params) => client.query(sql, params));
    const currentRates = Object.fromEntries(rates.map((row) => [row.price_kind, { id: row.id, version: row.version,
      locationId: row.location_id, amount: row.amount, currency: row.currency, status: row.amount === null ? "unknown" : "known",
      sellingPolicyVersionId: row.selling_policy_version_id || null }]));
    const labor = { status: "incomplete", price: null, currentRates };
    const selectedRate = rates.find((row) => row.price_kind === input.pricing?.labor?.selection);
    if (selectedRate?.amount !== null && selectedRate?.currency && Number(input.formData.laborHours) > 0) {
      try {
        const uomCode = selectedRate.product_uom_code || input.formData?.laborProduct?.uomCode || "hr";
        if (uomCode !== (input.formData?.laborProduct?.uomCode || "hr")) throw new Error("Labor unit changed.");
        if (!validLaborQuantity(input.formData.laborHours, uomCode)) throw new Error("Invalid labor quantity.");
        const hours = scaled(input.formData.laborHours, 2);
        labor.price = applyCreatePriceOverride({ selection: selectedRate.price_kind, productId: selectedRate.labor_product_id,
          rateVersionId: selectedRate.selling_policy_version_id ? null : selectedRate.id,
          sellingPolicyVersionId: selectedRate.selling_policy_version_id || null,
          hours: String(input.formData.laborHours), uomCode, unitPrice: selectedRate.amount,
          totalPrice: fixed(divide(scaled(selectedRate.amount, 4) * hours, 100n)), currency: selectedRate.currency },
        input.pricing?.labor?.customUnitPrice);
        labor.status = "known";
      } catch { labor.reason = "Enter a valid quantity for the labor unit."; }
    }
    const summary = workorderPricingSummary({ workorder: { formData: { ...input.formData,
      parts: input.formData.parts.filter((_, index) => !parts.some((row) => row.partIndex === index && row.price)) } },
      aggregatePartUsages: parts.filter((row) => row.price).map((row) => ({ status: "reserved", effectiveQuantity: input.formData.parts[row.partIndex].qty, price: row.price })),
      laborPrice: labor.price });
    if (!transactionClient) await client.query("commit");
    return { fingerprint: createPricingFingerprint(input, parts, labor), parts, labor, summary };
  } catch (error) {
    if (!transactionClient) await client.query("rollback").catch(() => {});
    throw error;
  } finally { if (!transactionClient) client.release(); }
}
