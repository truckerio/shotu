import { canonicalFinancialHash } from "../../modules/customer-documents/customer-financial-calculator.js";

function sourceError(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function asText(value) {
  return value === null || value === undefined ? null : String(value);
}

/**
 * Reads and locks the complete billable Workorder scope through one transaction client.
 * Workorder mutators lock the Workorder row first, so this row lock serializes the
 * version, usage lifecycle and immutable price-snapshot selection as one source view.
 */
export async function readLockedWorkorderFinancialSource(input, client) {
  if (!client?.query) throw new TypeError("A transaction client is required for Workorder financial sources.");
  const workorder = (await client.query(
    `select wo.id,wo.company_id,wo.location_id,wo.asset_id,wo.status,wo.progress_version,
            wo.concern,wo.diagnosis,wo.work_performed,wo.form_data,wo.mechanic_done_at,
            asset.unit_no,asset.vin,asset.make,asset.model,asset.year,asset.owner_name
       from operational_workorders wo
       left join assets asset on asset.company_id=wo.company_id and asset.id=wo.asset_id
      where wo.company_id=$1 and wo.location_id=$2 and wo.id=$3
      for update of wo`,
    [input.companyId, input.locationId, input.workorderId],
  )).rows[0];
  if (!workorder) sourceError("CUSTOMER_DOCUMENT_WORKORDER_NOT_FOUND");

  const serialized = (await client.query(
    `select usage.id,usage.status,usage.catalog_part_id,usage.uom_code,
            catalog.part_number,catalog.description,
            price.id price_snapshot_id,price.selection,price.unit_price,price.quantity price_quantity,
            price.total_price,price.currency,price.selling_policy_version_id,
            price.manual_override,price.base_unit_price
       from workorder_serialized_part_usages usage
       join parts_catalog catalog on catalog.company_id=usage.company_id and catalog.id=usage.catalog_part_id
       left join lateral (
         select snapshot.* from workorder_part_price_snapshots snapshot
          where snapshot.company_id=usage.company_id and snapshot.serialized_usage_id=usage.id
          order by snapshot.created_at desc,snapshot.id desc limit 1
       ) price on true
      where usage.company_id=$1 and usage.workorder_id=$2
        and usage.status in ('issued','reserved','installed_pending_approval','installed')
      order by usage.id
      for share of usage,catalog`,
    [input.companyId, input.workorderId],
  )).rows;

  const aggregate = (await client.query(
    `select usage.id,usage.status,usage.catalog_part_id,usage.uom_code,usage.repair_order,
            usage.quantity+usage.adjustment_total effective_quantity,
            catalog.part_number,catalog.description,
            price.id price_snapshot_id,price.selection,price.unit_price,price.quantity price_quantity,
            price.total_price,price.currency,price.selling_policy_version_id,
            price.manual_override,price.base_unit_price
       from workorder_aggregate_part_usages usage
       join parts_catalog catalog on catalog.company_id=usage.company_id and catalog.id=usage.catalog_part_id
       left join lateral (
         select snapshot.* from workorder_part_price_snapshots snapshot
          where snapshot.company_id=usage.company_id and snapshot.aggregate_usage_id=usage.id
          order by snapshot.created_at desc,snapshot.id desc limit 1
       ) price on true
      where usage.company_id=$1 and usage.workorder_id=$2
        and usage.status in ('reserved','installed_pending_approval','consumed')
        and usage.quantity+usage.adjustment_total>0
      order by usage.id
      for share of usage,catalog`,
    [input.companyId, input.workorderId],
  )).rows;

  const labor = (await client.query(
    `select snapshot.*,product.name product_name,product.description product_description,product.uom_code product_uom_code
       from workorder_labor_price_snapshots snapshot
       join local_labor_products product
         on product.company_id=snapshot.company_id and product.id=snapshot.labor_product_id
      where snapshot.company_id=$1 and snapshot.workorder_id=$2
      order by snapshot.created_at desc,snapshot.id desc limit 1
      for share of snapshot,product`,
    [input.companyId, input.workorderId],
  )).rows[0] || null;

  const formData = workorder.form_data || {};
  const expectedLaborHours = Number(formData.laborHours || 0);
  if (expectedLaborHours > 0 && (!labor || Number(labor.hours) !== expectedLaborHours
    || (formData.laborProduct?.productId && labor.labor_product_id !== formData.laborProduct.productId)
    || (labor.uom_code || labor.product_uom_code || "hr") !== (formData.laborProduct?.uomCode || "hr"))) {
    sourceError("CUSTOMER_DOCUMENT_SELLING_PRICE_REQUIRED");
  }
  const partRows = [
    ...serialized.map((row) => ({ ...row, quantity: "1", sourceKind: "serialized_usage" })),
    ...aggregate.map((row) => ({ ...row, quantity: asText(row.effective_quantity), sourceKind: "aggregate_usage" })),
  ];
  for (const row of partRows) {
    if (!row.price_snapshot_id || row.selection !== "selling_price"
      || Number(row.price_quantity) !== Number(row.quantity)) {
      sourceError("CUSTOMER_DOCUMENT_SELLING_PRICE_REQUIRED");
    }
  }
  if (labor && labor.selection !== "selling_price") sourceError("CUSTOMER_DOCUMENT_SELLING_PRICE_REQUIRED");

  const pricingEvidence = [
    ...(labor ? [{ kind: "labor", id: labor.id, sourceId: labor.labor_product_id, quantity: asText(labor.hours), unit: labor.uom_code || labor.product_uom_code || "hr", unitPrice: asText(labor.unit_price), total: asText(labor.total_price), currency: labor.currency }] : []),
    ...partRows.map((row) => ({ kind: row.sourceKind, id: row.price_snapshot_id, sourceId: row.id, quantity: row.quantity, unitPrice: asText(row.unit_price), total: asText(row.total_price), currency: row.currency })),
  ];
  const pricingFingerprint = canonicalFinancialHash({ workorderId: workorder.id, pricingEvidence });
  return {
    workorder: {
      id: workorder.id,
      companyId: workorder.company_id,
      locationId: workorder.location_id,
      assetId: workorder.asset_id,
      status: workorder.status,
      progressVersion: Number(workorder.progress_version),
      concern: workorder.concern || "",
      diagnosis: workorder.diagnosis || "",
      workPerformed: workorder.work_performed || "",
      mechanicDoneAt: workorder.mechanic_done_at || null,
      formData,
      asset: {
        unitNo: workorder.unit_no || formData.unitNo || "",
        vin: workorder.vin || formData.vinNo || null,
        make: workorder.make || null,
        model: workorder.model || formData.model || null,
        year: workorder.year || null,
        ownerName: workorder.owner_name || null,
      },
    },
    labor: labor ? {
      id: labor.id,
      productId: labor.labor_product_id,
      description: labor.product_description || labor.product_name || "Labor",
      hours: asText(labor.hours),
      uomCode: labor.uom_code || labor.product_uom_code || "hr",
      unitPrice: asText(labor.unit_price),
      totalPrice: asText(labor.total_price),
      currency: labor.currency,
      rateVersionId: labor.rate_version_id,
      sellingPolicyVersionId: labor.selling_policy_version_id || null,
      manualOverride: labor.manual_override === true,
    } : null,
    parts: partRows.map((row) => ({
      usageId: row.id,
      sourceKind: row.sourceKind,
      status: row.status,
      catalogPartId: row.catalog_part_id,
      description: row.repair_order || row.description || row.part_number || "Part",
      quantity: row.quantity,
      unit: row.uom_code || "ea",
      priceSnapshotId: row.price_snapshot_id,
      sellingPolicyVersionId: row.selling_policy_version_id,
      unitPrice: asText(row.unit_price),
      totalPrice: asText(row.total_price),
      currency: row.currency,
      manualOverride: row.manual_override === true,
    })),
    pricingFingerprint,
  };
}
