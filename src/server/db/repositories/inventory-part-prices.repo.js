import { getPool, query } from "../pool.js";

function publicPrice(row) {
  if (!row) return null;
  return {
    id: row.id,
    locationId: row.location_id || null,
    kind: row.price_kind,
    version: Number(row.version),
    status: row.amount === null ? "unknown" : "known",
    amount: row.amount === null ? null : String(row.amount),
    currency: row.currency || null,
    taxTreatment: row.tax_treatment || "legacy_unknown",
    taxProfileVersionId: row.tax_profile_version_id || null,
    taxProfile: row.tax_profile || null,
    effectiveAt: row.effective_at,
    reason: row.reason,
    createdAt: row.created_at,
    createdBy: row.created_by ? { id: row.created_by, name: row.created_by_name || "" } : null,
  };
}

const TAX_PROFILE_JSON = `case when tax_version.id is null then null else jsonb_build_object(
  'id', tax_version.id, 'profileId', tax_version.profile_id, 'version', tax_version.version,
  'name', tax_version.name, 'currency', tax_version.currency, 'jurisdiction', tax_version.jurisdiction,
  'components', tax_version.components, 'state', tax_version.state) end as tax_profile`;

function validCurrency(value) {
  const currency = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) && currency !== "UNK" ? currency : null;
}

function publicObservation(row) {
  const currency = validCurrency(row.currency);
  const unitCost = row.unit_cost === null ? null : String(row.unit_cost);
  const known = unitCost !== null && currency !== null;
  return {
    receiptLineId: row.receipt_line_id,
    receiptId: row.receipt_id,
    invoiceRunId: row.invoice_run_id,
    locationId: row.location_id,
    locationName: row.location_name,
    quantity: String(row.quantity),
    uomCode: row.uom_code,
    unitCost: known ? unitCost : null,
    lineTotal: known && row.line_total !== null ? String(row.line_total) : null,
    currency: known ? currency : null,
    status: known ? "known" : "unknown",
    basis: row.invoice_run_id ? known ? "source_invoice_line" : "source_invoice_line_missing_cost" : known ? "source_receipt_line" : "unpriced_receipt",
    occurredOn: row.invoice_date || row.posted_at,
    dateBasis: row.invoice_date ? "invoice_date" : "received_at",
    receivedAt: row.posted_at,
    source: {
      type: row.invoice_run_id ? "invoice" : row.provider === "local_count" ? "stock_count" : row.provider === "local_manual" ? "manual_intake" : row.provider === "local_serialization" ? "manual_serialization" : "receipt",
      id: row.invoice_run_id || row.count_import_id || row.manual_intake_batch_id || row.serialization_batch_id || row.receipt_id,
      vendorName: row.vendor_name || "",
      invoiceNumber: row.invoice_number || "",
    },
    invoice: row.invoice_run_id ? {
      runId: row.invoice_run_id,
      vendorName: row.vendor_name || "",
      invoiceNumber: row.invoice_number || "",
      invoiceDate: row.invoice_date || null,
    } : null,
  };
}

function publicPurchaseOrderLine(row) {
  return {
    lineId: row.line_id,
    orderId: row.order_id,
    orderExternalId: row.order_external_id,
    orderNumber: row.order_number,
    vendorName: row.vendor_name || "",
    status: row.order_status,
    orderedAt: row.ordered_at,
    approvedAt: row.approved_at,
    quantity: row.ordered_quantity === null ? null : String(row.ordered_quantity),
    receivedQuantity: row.received_quantity === null ? null : String(row.received_quantity),
    invoicedQuantity: row.invoiced_quantity === null ? null : String(row.invoiced_quantity),
    uomCode: row.uom || "",
    unitCost: row.unit_price === null ? null : String(row.unit_price),
    lineTotal: row.subtotal === null ? null : String(row.subtotal),
    currency: validCurrency(row.currency),
    source: { type: "odoo_purchase_order", id: row.order_external_id },
  };
}

export async function getInventoryPartCommercial({ catalogPartId, companyIds, locationIds = [], isAdmin = false, locationId = null, historyLimit = 100 }) {
  const partResult = await query(
    `select catalog.id, catalog.company_id, catalog.part_number, catalog.description, catalog.uom_code,
            catalog.inventory_display_uom_code, catalog.tracking_mode,
            scoped_location.id as scope_location_id, scoped_location.name as scope_location_name
     from parts_catalog catalog
     left join locations scoped_location
       on scoped_location.company_id=catalog.company_id and scoped_location.id=$3 and scoped_location.active=true
     where catalog.id=$1 and catalog.company_id=any($2::uuid[])
       and ($3::uuid is null or scoped_location.id is not null)
       and ($3::uuid is null or $5::boolean or scoped_location.id=any($4::uuid[]))
     limit 1`,
    [catalogPartId, companyIds, locationId, locationIds, isAdmin],
  );
  const part = partResult.rows[0];
  if (!part) return null;
  const [observationsResult, coverageResult, pricesResult, purchaseOrdersResult] = await Promise.all([
    query(
      `select line.id as receipt_line_id, line.receipt_id, receipt.invoice_run_id,
              receipt.count_import_id, receipt.manual_intake_batch_id, receipt.serialization_batch_id, receipt.provider,
              receipt.location_id, location.name as location_name, line.quantity,
              line.uom_code, cost.unit_cost, cost.line_total, coalesce(receipt.confirmed_at, receipt.created_at) as posted_at,
              coalesce(line.currency, coalesce(run.reviewed_draft, run.extracted_draft) #>> '{currency,value}') as currency,
              coalesce(run.reviewed_draft, run.extracted_draft) #>> '{invoiceDate,value}' as invoice_date,
              coalesce(run.reviewed_draft, run.extracted_draft) #>> '{vendorName,value}' as vendor_name,
              coalesce(run.reviewed_draft, run.extracted_draft) #>> '{invoiceNumber,value}' as invoice_number
       from inventory_receipt_lines line
       join inventory_receipts receipt on receipt.company_id=line.company_id and receipt.id=line.receipt_id
       join locations location on location.company_id=receipt.company_id and location.id=receipt.location_id
       left join local_inventory_receipt_lines cost on cost.company_id=line.company_id and cost.id=line.id
       left join invoice_extraction_runs run on run.company_id=receipt.company_id and run.id=receipt.invoice_run_id
       where line.company_id=$1 and line.catalog_part_id=$2 and receipt.status='confirmed'
         and (($5::uuid is not null and receipt.location_id=$5)
           or ($5::uuid is null and ($4::boolean or receipt.location_id=any($3::uuid[]))))
       order by coalesce(receipt.confirmed_at, receipt.created_at) desc, line.id desc limit $6`,
      [part.company_id, catalogPartId, locationIds, isAdmin, locationId, historyLimit],
    ),
    query(
      `select
         coalesce(sum(line.quantity) filter (where cost.unit_cost is not null and coalesce(upper(coalesce(line.currency, coalesce(run.reviewed_draft, run.extracted_draft) #>> '{currency,value}')), '') ~ '^[A-Z]{3}$' and coalesce(upper(coalesce(line.currency, coalesce(run.reviewed_draft, run.extracted_draft) #>> '{currency,value}')), '') <> 'UNK'), 0) as known_quantity,
         coalesce(sum(line.quantity) filter (where cost.unit_cost is null or not (coalesce(upper(coalesce(line.currency, coalesce(run.reviewed_draft, run.extracted_draft) #>> '{currency,value}')), '') ~ '^[A-Z]{3}$') or coalesce(upper(coalesce(line.currency, coalesce(run.reviewed_draft, run.extracted_draft) #>> '{currency,value}')), '') = 'UNK'), 0) as unknown_quantity,
         count(*) filter (where cost.unit_cost is not null and coalesce(upper(coalesce(line.currency, coalesce(run.reviewed_draft, run.extracted_draft) #>> '{currency,value}')), '') ~ '^[A-Z]{3}$' and coalesce(upper(coalesce(line.currency, coalesce(run.reviewed_draft, run.extracted_draft) #>> '{currency,value}')), '') <> 'UNK')::int as known_lines,
         count(*) filter (where cost.unit_cost is null or not (coalesce(upper(coalesce(line.currency, coalesce(run.reviewed_draft, run.extracted_draft) #>> '{currency,value}')), '') ~ '^[A-Z]{3}$') or coalesce(upper(coalesce(line.currency, coalesce(run.reviewed_draft, run.extracted_draft) #>> '{currency,value}')), '') = 'UNK')::int as unknown_lines
       from inventory_receipt_lines line
       join inventory_receipts receipt on receipt.company_id=line.company_id and receipt.id=line.receipt_id
       left join local_inventory_receipt_lines cost on cost.company_id=line.company_id and cost.id=line.id
       left join invoice_extraction_runs run on run.company_id=receipt.company_id and run.id=receipt.invoice_run_id
       where line.company_id=$1 and line.catalog_part_id=$2 and receipt.status='confirmed'
         and (($5::uuid is not null and receipt.location_id=$5)
           or ($5::uuid is null and ($4::boolean or receipt.location_id=any($3::uuid[]))))`,
      [part.company_id, catalogPartId, locationIds, isAdmin, locationId],
    ),
    query(
      `with ranked as (
         select price.*, row_number() over (partition by price_kind, location_id order by version desc) as kind_rank
         from inventory_part_price_versions price
         where price.company_id=$1 and price.catalog_part_id=$2
           and (price.location_id is null or price.location_id=$3)
       ) select price.*, actor.display_name as created_by_name, ${TAX_PROFILE_JSON}
       from ranked price
       left join user_profiles actor on actor.id=price.created_by
       left join inventory_tax_profile_versions tax_version
         on tax_version.company_id=price.company_id and tax_version.id=price.tax_profile_version_id
       where price.kind_rank <= 50
       order by price.price_kind, price.version desc`,
      [part.company_id, catalogPartId, locationId],
    ),
    query(
      `select line.id line_id, line.purchase_order_id order_id,
              purchase.external_id order_external_id, purchase.reference order_number,
              purchase.vendor_name, purchase.status order_status, purchase.currency,
              purchase.ordered_at, purchase.approved_at,
              line.ordered_quantity, line.received_quantity, line.invoiced_quantity,
              line.uom, line.unit_price, line.subtotal
       from odoo_purchase_history_lines line
       join odoo_purchase_history_orders purchase
         on purchase.company_id=line.company_id and purchase.id=line.purchase_order_id
       where line.company_id=$1 and line.catalog_part_id=$2
       order by coalesce(purchase.approved_at,purchase.ordered_at) desc nulls last,
                purchase.id desc,line.sequence,line.id
       limit $3`,
      [part.company_id, catalogPartId, historyLimit],
    ),
  ]);
  const observations = observationsResult.rows.map(publicObservation);
  const coverageRow = coverageResult.rows[0] || {};
  const coverage = { knownQuantity: Number(coverageRow.known_quantity || 0), unknownQuantity: Number(coverageRow.unknown_quantity || 0), knownLines: Number(coverageRow.known_lines || 0), unknownLines: Number(coverageRow.unknown_lines || 0) };
  const histories = {
    internal: { companyDefault: [], locationOverride: [] },
    selling: { companyDefault: [], locationOverride: [] },
  };
  for (const row of pricesResult.rows) {
    histories[row.price_kind][row.location_id ? "locationOverride" : "companyDefault"].push(publicPrice(row));
  }
  const priceProjection = (kind) => {
    const companyDefault = histories[kind].companyDefault;
    const locationOverride = histories[kind].locationOverride;
    const effectiveHistory = locationOverride.length ? locationOverride : companyDefault;
    return {
      current: effectiveHistory[0] || null,
      history: effectiveHistory,
      effective: effectiveHistory[0] || null,
      source: locationOverride.length ? "location_override" : companyDefault.length ? "company_default" : null,
      override: { current: locationOverride[0] || null, history: locationOverride },
      companyDefault: { current: companyDefault[0] || null, history: companyDefault },
    };
  };
  const receiptCosts = {
    status: coverage.knownQuantity === 0 ? "unknown" : coverage.unknownQuantity > 0 ? "partial" : "known",
    basis: "receipt_line_source_facts",
    latest: observations[0] || null,
    coverage,
    observations,
    truncated: observationsResult.rows.length >= historyLimit,
  };
  const purchaseOrderObservations = purchaseOrdersResult.rows.map(publicPurchaseOrderLine);
  const purchaseOrders = {
    status: purchaseOrderObservations.length ? "known" : "unknown",
    basis: "odoo_purchase_order_lines",
    latest: purchaseOrderObservations.find((entry) => entry.unitCost !== null && entry.currency) || null,
    observations: purchaseOrderObservations,
    truncated: purchaseOrdersResult.rows.length >= historyLimit,
  };
  return {
    part: { catalogPartId: part.id, companyId: part.company_id, partNumber: part.part_number, description: part.description || "", uomCode: part.uom_code, displayUomCode: part.inventory_display_uom_code || part.uom_code, trackingMode: part.tracking_mode || null },
    scope: locationId ? { locationId: part.scope_location_id, locationName: part.scope_location_name } : { locationId: null, locationName: null },
    purchaseCost: receiptCosts,
    receiptCosts,
    purchaseOrders,
    prices: {
      internal: priceProjection("internal"),
      selling: priceProjection("selling"),
    },
  };
}

export async function appendInventoryPartPrice({ catalogPartId, companyIds, locationIds = [], isAdmin = false, locationId = null, actorId, kind, expectedVersion, amount, currency, taxTreatment, taxProfileVersionId, reason, idempotencyKey, requestHash }) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const part = await client.query(
      `select catalog.company_id
       from parts_catalog catalog
       left join locations scoped_location
         on scoped_location.company_id=catalog.company_id and scoped_location.id=$3 and scoped_location.active=true
       where catalog.id=$1 and catalog.company_id=any($2::uuid[])
         and ($3::uuid is null or scoped_location.id is not null)
         and ($3::uuid is null or $5::boolean or scoped_location.id=any($4::uuid[]))
       limit 1`,
      [catalogPartId, companyIds, locationId, locationIds, isAdmin],
    );
    if (!part.rows[0]) { await client.query("rollback"); return { kind: "not_found" }; }
    const companyId = part.rows[0].company_id;
    const scopeKey = locationId || "company-default";
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`inventory-part-price:${companyId}:${catalogPartId}:${kind}:${scopeKey}`]);
    const replay = await client.query(
      `select price.*, actor.display_name as created_by_name, ${TAX_PROFILE_JSON}
       from inventory_part_price_versions price left join user_profiles actor on actor.id=price.created_by
       left join inventory_tax_profile_versions tax_version
         on tax_version.company_id=price.company_id and tax_version.id=price.tax_profile_version_id
       where price.company_id=$1 and price.created_by=$2 and price.idempotency_key=$3 limit 1`,
      [companyId, actorId, idempotencyKey],
    );
    if (replay.rows[0]) {
      await client.query("commit");
      return replay.rows[0].request_hash === requestHash
        ? { kind: "saved", price: publicPrice(replay.rows[0]), replayed: true }
        : { kind: "idempotency_conflict" };
    }
    const current = await client.query(
      `select id, version, tax_treatment from inventory_part_price_versions
       where company_id=$1 and catalog_part_id=$2 and price_kind=$3
         and location_id is not distinct from $4::uuid
       order by version desc limit 1`,
      [companyId, catalogPartId, kind, locationId],
    );
    const currentVersion = Number(current.rows[0]?.version || 0);
    if (currentVersion !== expectedVersion) { await client.query("rollback"); return { kind: "stale", currentVersion }; }
    let resolvedTreatment = taxTreatment;
    let resolvedProfileVersionId = taxProfileVersionId ?? null;
    if (resolvedTreatment === undefined) {
      if (current.rows[0] && !["legacy_unknown", "not_configured"].includes(current.rows[0].tax_treatment)) {
        await client.query("rollback"); return { kind: "tax_required" };
      }
      resolvedTreatment = "not_configured";
      resolvedProfileVersionId = null;
    }
    if (amount === null) { resolvedTreatment = "not_configured"; resolvedProfileVersionId = null; }
    if (["inclusive", "exclusive"].includes(resolvedTreatment)) {
      const profile = await client.query(`select version.id
        from inventory_tax_profile_versions version
        join inventory_tax_profiles profile
          on profile.company_id=version.company_id and profile.id=version.profile_id and profile.current_version_id=version.id
        where version.company_id=$1 and version.id=$2 and version.currency=$3 and version.state='active'
        limit 1 for share of profile, version`,
      [companyId, resolvedProfileVersionId, currency]);
      if (!profile.rows[0]) { await client.query("rollback"); return { kind: "tax_profile_invalid" }; }
    } else {
      resolvedProfileVersionId = null;
    }
    const inserted = await client.query(
      `insert into inventory_part_price_versions
         (company_id,location_id,catalog_part_id,price_kind,version,amount,currency,tax_treatment,tax_profile_version_id,previous_version_id,reason,created_by,idempotency_key,request_hash)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       returning id`,
      [companyId, locationId, catalogPartId, kind, currentVersion + 1, amount, currency, resolvedTreatment, resolvedProfileVersionId, current.rows[0]?.id || null, reason, actorId, idempotencyKey, requestHash],
    );
    const saved = await client.query(`select price.*, actor.display_name as created_by_name, ${TAX_PROFILE_JSON}
      from inventory_part_price_versions price
      left join user_profiles actor on actor.id=price.created_by
      left join inventory_tax_profile_versions tax_version
        on tax_version.company_id=price.company_id and tax_version.id=price.tax_profile_version_id
      where price.company_id=$1 and price.id=$2`, [companyId, inserted.rows[0].id]);
    await client.query("commit");
    return { kind: "saved", price: publicPrice(saved.rows[0]), replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error?.code === "23505") return { kind: "idempotency_conflict" };
    if (error?.code === "23514") return { kind: "tax_profile_invalid" };
    throw error;
  } finally { client.release(); }
}

export async function getInventoryPartPricingSource({ catalogPartId, companyIds, locationIds = [], isAdmin = false, locationId = null, kind }) {
  const result = await query(`select catalog.id as catalog_part_id, catalog.company_id as catalog_company_id, catalog.uom_code,
      catalog.inventory_display_uom_code, catalog.tracking_mode,
      price.*, actor.display_name as created_by_name, ${TAX_PROFILE_JSON}
    from parts_catalog catalog
    left join lateral (
      select candidate.* from inventory_part_price_versions candidate
      where candidate.company_id=catalog.company_id and candidate.catalog_part_id=catalog.id and candidate.price_kind=$3
        and (candidate.location_id is null or candidate.location_id=$4)
      order by (candidate.location_id is not null) desc, candidate.version desc limit 1
    ) price on true
    left join user_profiles actor on actor.id=price.created_by
    left join inventory_tax_profile_versions tax_version
      on tax_version.company_id=price.company_id and tax_version.id=price.tax_profile_version_id
    left join locations scoped_location
      on scoped_location.company_id=catalog.company_id and scoped_location.id=$4 and scoped_location.active=true
    where catalog.id=$1 and catalog.company_id=any($2::uuid[])
      and ($4::uuid is null or scoped_location.id is not null)
      and ($4::uuid is null or $6::boolean or scoped_location.id=any($5::uuid[]))
    limit 1`, [catalogPartId, companyIds, kind, locationId, locationIds, isAdmin]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    part: { catalogPartId: row.catalog_part_id, companyId: row.catalog_company_id, uomCode: row.uom_code, displayUomCode: row.inventory_display_uom_code || row.uom_code, trackingMode: row.tracking_mode || null },
    price: row.id ? publicPrice(row) : null,
  };
}
