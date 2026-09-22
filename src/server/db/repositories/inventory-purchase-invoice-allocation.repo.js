import { getPool } from "../pool.js";

const normalize = (value) => String(value || "").normalize("NFKC").trim().toLocaleUpperCase("en-US").replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function suggestPurchaseInvoiceAllocations({ runId, companyIds, locationIds = [], isAdmin = false }) {
  const client = await getPool().connect();
  try {
    const run = await client.query(`select r.id,r.company_id,r.location_id,r.status,r.version,r.reviewed_draft,
      s.name as supplier_name
      from invoice_extraction_runs r
      join locations loc on loc.company_id=r.company_id and loc.id=r.location_id
      left join inventory_suppliers s on s.company_id=r.company_id
        and lower(trim(s.name))=lower(trim(coalesce(r.reviewed_draft #>> '{vendorName,value}','')))
      where r.id=$1 and r.company_id=any($2::uuid[]) and ($4::boolean or r.location_id=any($3::uuid[]))
      limit 1`, [runId, companyIds, locationIds, isAdmin]);
    const source = run.rows[0];
    if (!source) return { kind: "not_found" };
    if (source.status !== "reviewed" || !source.reviewed_draft) return { kind: "review_required", version: Number(source.version) };
    const draft = source.reviewed_draft;
    const lines = Array.isArray(draft.lines) ? draft.lines : [];
    const received = await client.query(`select line.line_index,sum(coalesce(delivery_line.usable_quantity,line.quantity))::numeric as quantity
      from local_inventory_receipt_lines line
      join local_inventory_receipts receipt on receipt.company_id=line.company_id and receipt.id=line.receipt_id
      left join inventory_purchase_delivery_lines delivery_line on delivery_line.company_id=line.company_id and delivery_line.receipt_line_id=line.id
      where receipt.company_id=$1 and receipt.invoice_run_id=$2 and receipt.status='posted'
      group by line.line_index`, [source.company_id, source.id]);
    const receivedByLine = new Map(received.rows.map((row) => [Number(row.line_index), Number(row.quantity)]));
    const catalogIds = [...new Set(lines.map((line) => line.catalogPartId).filter(Boolean))];
    const tracking = catalogIds.length ? await client.query(
      `select id,tracking_mode,uom_code from parts_catalog where company_id=$1 and id=any($2::uuid[])`,
      [source.company_id, catalogIds],
    ) : { rows: [] };
    const trackingById = new Map(tracking.rows.map((row) => [row.id, row]));
    const receiptLines = lines.map((line, invoiceLineIndex) => ({
      invoiceLineIndex,
      purchaseLineId: null,
      invoiceOutstandingQuantity: Math.max(Number(line.quantity?.value) - (receivedByLine.get(invoiceLineIndex) || 0), 0),
      trackingMode: trackingById.get(line.catalogPartId)?.tracking_mode || null,
      uomCode: trackingById.get(line.catalogPartId)?.uom_code || String(line.unitOfMeasure?.value || "").trim().toLowerCase(),
    }));
    const poNumber = normalize(draft.purchaseOrderNumber?.value);
    if (!poNumber) return { kind: "none", reason: "no_purchase_order", version: Number(source.version), receiptLines };
    const candidates = await client.query(`select o.id as order_id,o.number,o.status,o.location_id,o.supplier_id,s.name as supplier_name,
      l.id as purchase_line_id,l.catalog_part_id,l.part_number,l.uom_code,l.tracking_mode,
      l.quantity,l.received_quantity,l.cancelled_quantity,
      greatest(l.quantity-l.received_quantity-l.cancelled_quantity,0) as outstanding_quantity
      from inventory_purchase_orders o
      join inventory_suppliers s on s.company_id=o.company_id and s.id=o.supplier_id
      join inventory_purchase_lines l on l.company_id=o.company_id and l.order_id=o.id
      where o.company_id=$1 and o.location_id=$2
        and trim(both '-' from regexp_replace(upper(coalesce(o.number,'')), '[^A-Z0-9]+', '-', 'g'))=$3
        and lower(trim(s.name))=lower(trim($4))
        and o.status in ('ordered','partially_received','received')
        and l.quantity>l.received_quantity+l.cancelled_quantity
      order by o.id,l.id`, [source.company_id, source.location_id, poNumber, String(draft.vendorName?.value || "")]);
    if (!candidates.rows.length) return { kind: "none", reason: "no_exact_match", version: Number(source.version), purchaseOrderNumber: draft.purchaseOrderNumber?.value || "", receiptLines };
    const matches = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const part = normalize(line.partNumber?.value);
      const uom = String(line.unitOfMeasure?.value || "").trim().toLowerCase();
      const invoiceQuantity = Number(line.quantity?.value);
      const quantity = Math.max(invoiceQuantity - (receivedByLine.get(index) || 0), 0);
      if (quantity <= 0) continue;
      const eligible = candidates.rows.filter((candidate) =>
        (!line.catalogPartId || candidate.catalog_part_id === line.catalogPartId)
        && (!line.catalogPartId ? normalize(candidate.part_number) === part : true)
        && candidate.uom_code.toLowerCase() === uom
        && Number(candidate.outstanding_quantity) > 0
      );
      if (eligible.length === 1) matches.push({
        invoiceLineIndex: index,
        purchaseLineId: eligible[0].purchase_line_id,
        quantity: Math.min(quantity, Number(eligible[0].outstanding_quantity)),
        invoiceOutstandingQuantity: quantity,
        trackingMode: eligible[0].tracking_mode,
        candidate: eligible[0],
      });
      else if (eligible.length > 1) return { kind: "ambiguous", version: Number(source.version), purchaseOrderNumber: draft.purchaseOrderNumber?.value || "", invoiceLineIndex: index, candidates: eligible, receiptLines };
      else return { kind: "none", reason: "no_line_match", version: Number(source.version), purchaseOrderNumber: draft.purchaseOrderNumber?.value || "", invoiceLineIndex: index, receiptLines };
    }
    if (!matches.length) return { kind: "none", reason: "invoice_fully_received", version: Number(source.version), purchaseOrderNumber: draft.purchaseOrderNumber?.value || "", receiptLines };
    return { kind: "suggestions", version: Number(source.version), purchaseOrderNumber: draft.purchaseOrderNumber?.value || "", candidates: matches, receiptLines };
  } finally { client.release(); }
}
