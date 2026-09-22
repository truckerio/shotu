import { getPool } from "../../db/pool.js";
import { requireCompanyId } from "../../db/company.js";

const relationId = (value) => Array.isArray(value) ? String(value[0] || "") : String(value || "");
const relationName = (value) => Array.isArray(value) ? String(value[1] || "") : "";
const nullableNumber = (value) => value === null || value === undefined || value === false || value === "" ? null : Number(value);

export async function importOdooPurchaseHistory(companyId, { orders = [], lines = [], activeOrderIds = [] }) {
  const tenantId = requireCompanyId(companyId);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const mappingsResult = await client.query(
      `select external_id, catalog_part_id from odoo_product_mappings where company_id=$1`,
      [tenantId],
    );
    const mappings = new Map(mappingsResult.rows.map((row) => [String(row.external_id), row.catalog_part_id]));
    const retainedIds = activeOrderIds.map(String);
    const removed = await client.query(
      `delete from odoo_purchase_history_orders
       where company_id=$1 and not (external_id=any($2::text[]))`,
      [tenantId, retainedIds],
    );
    if (!orders.length) {
      await client.query("commit");
      return { purchaseOrderCount: 0, purchaseLineCount: 0, purchaseRemovedCount: removed.rowCount, mappedLineCount: 0 };
    }
    const orderRows = orders.map((order) => ({
      external_id: String(order.id),
      reference: String(order.name || `Odoo ${order.id}`),
      status: String(order.state || ""),
      vendor_external_id: relationId(order.partner_id),
      vendor_name: relationName(order.partner_id),
      currency: relationName(order.currency_id),
      ordered_at: order.date_order || null,
      approved_at: order.date_approve || null,
      amount_total: nullableNumber(order.amount_total),
      source_updated_at: order.write_date || null,
      raw_payload: order,
    }));
    const saved = await client.query(
      `insert into odoo_purchase_history_orders (
         company_id,external_id,reference,status,vendor_external_id,vendor_name,currency,
         ordered_at,approved_at,amount_total,source_updated_at,raw_payload,last_seen_at,updated_at
       ) select $1,source.external_id,source.reference,source.status,source.vendor_external_id,
         source.vendor_name,source.currency,source.ordered_at,source.approved_at,source.amount_total,
         source.source_updated_at,source.raw_payload,now(),now()
       from jsonb_to_recordset($2::jsonb) as source(
         external_id text,reference text,status text,vendor_external_id text,vendor_name text,currency text,
         ordered_at timestamptz,approved_at timestamptz,amount_total numeric,source_updated_at timestamptz,raw_payload jsonb
       ) on conflict (company_id,external_id) do update set
         reference=excluded.reference,status=excluded.status,vendor_external_id=excluded.vendor_external_id,
         vendor_name=excluded.vendor_name,currency=excluded.currency,ordered_at=excluded.ordered_at,
         approved_at=excluded.approved_at,amount_total=excluded.amount_total,
         source_updated_at=excluded.source_updated_at,raw_payload=excluded.raw_payload,
         last_seen_at=now(),updated_at=now()
       returning id,external_id`,
      [tenantId, JSON.stringify(orderRows)],
    );
    const orderIds = new Map(saved.rows.map((row) => [String(row.external_id), row.id]));
    await client.query(
      `delete from odoo_purchase_history_lines where company_id=$1 and purchase_order_id=any($2::uuid[])`,
      [tenantId, [...orderIds.values()]],
    );
    const lineRows = lines.flatMap((line) => {
      const purchaseOrderId = orderIds.get(relationId(line.order_id));
      if (!purchaseOrderId || line.display_type) return [];
      const productExternalId = relationId(line.product_id);
      return [{
        purchase_order_id: purchaseOrderId,
        external_id: String(line.id),
        sequence: nullableNumber(line.sequence) || 0,
        product_external_id: productExternalId,
        catalog_part_id: mappings.get(productExternalId) || null,
        description: String(line.name || relationName(line.product_id) || ""),
        ordered_quantity: nullableNumber(line.product_qty),
        received_quantity: nullableNumber(line.qty_received),
        invoiced_quantity: nullableNumber(line.qty_invoiced),
        uom: relationName(line.product_uom),
        unit_price: nullableNumber(line.price_unit),
        subtotal: nullableNumber(line.price_subtotal),
        total: nullableNumber(line.price_total),
        planned_at: line.date_planned || null,
        source_updated_at: line.write_date || null,
        raw_payload: line,
      }];
    });
    for (let offset = 0; offset < lineRows.length; offset += 2000) {
      const batch = lineRows.slice(offset, offset + 2000);
      await client.query(
        `insert into odoo_purchase_history_lines (
           company_id,purchase_order_id,external_id,sequence,product_external_id,catalog_part_id,
           description,ordered_quantity,received_quantity,invoiced_quantity,uom,unit_price,
           subtotal,total,planned_at,source_updated_at,raw_payload
         ) select $1,source.purchase_order_id,source.external_id,source.sequence,source.product_external_id,
           source.catalog_part_id,source.description,source.ordered_quantity,source.received_quantity,
           source.invoiced_quantity,source.uom,source.unit_price,source.subtotal,source.total,
           source.planned_at,source.source_updated_at,source.raw_payload
         from jsonb_to_recordset($2::jsonb) as source(
           purchase_order_id uuid,external_id text,sequence numeric,product_external_id text,catalog_part_id uuid,
           description text,ordered_quantity numeric,received_quantity numeric,invoiced_quantity numeric,uom text,
           unit_price numeric,subtotal numeric,total numeric,planned_at timestamptz,source_updated_at timestamptz,raw_payload jsonb
         )`,
        [tenantId, JSON.stringify(batch)],
      );
    }
    await client.query("commit");
    return {
      purchaseOrderCount: orders.length,
      purchaseLineCount: lineRows.length,
      purchaseRemovedCount: removed.rowCount,
      mappedLineCount: lineRows.filter((line) => line.catalog_part_id).length,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
