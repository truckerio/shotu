import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { ModalFrame } from "../../components/ui/ModalFrame.jsx";
import { InvoiceDocumentViewer } from "../office/InvoiceDocumentViewer.jsx";
import { useCheckpointPages } from "../../components/operations/useCheckpointPages.js";
import { CheckpointCollection } from "../../components/ui/CheckpointCollection.jsx";

const labels = { invoice_receipt: "Invoice delivery", direct_receipt: "Stock received", receipt_reversal: "Receipt reversed", issue: "Used on Workorder", return: "Returned to stock", transfer_in: "Transfer received", transfer_out: "Transfer dispatched", adjustment: "Count or correction" };
function receiptHref(receiptId) {
  return `?${new URLSearchParams({ view: "inventory", adminView: "inventory", inventorySection: "inbound", receiptId })}`;
}
function workorderHref(workorderId) {
  return `?${new URLSearchParams({ workorder: workorderId, section: "concern" })}`;
}

export function StockMovementHistory({ partId, locationId = "", view = "audit", emptyMessage = "No stock activity.", refreshKey = 0 }) {
  const [receiptDocument, setReceiptDocument] = useState(null);
  useEffect(() => setReceiptDocument(null), [partId, locationId, view]);
  const scope = JSON.stringify([partId, locationId, view]);
  const queue = useCheckpointPages({ queryKey: scope, refreshKey,
    fetchPage: async (page, { signal }) => {
      const params = new URLSearchParams({ page: String(page) });
      if (locationId) params.set("locationId", locationId);
      if (view !== "audit") params.set("view", view);
      return api(`/api/office/inventory/parts/${partId}/movements?${params}`, { signal });
    },
  });
  const loading = queue.loading || queue.loadingMore;
  return <div className="inventory-stock-activity" aria-busy={loading}>
    {receiptDocument ? <ModalFrame overlayClassName="inventory-receipt-document-overlay" modalClassName="inventory-receipt-document-modal" dialogClassName="inventory-receipt-document-dialog" ariaLabelledBy="inventory-receipt-document-title" isDismissable onOpenChange={(open) => { if (!open) setReceiptDocument(null); }}>
      <header><div><h2 id="inventory-receipt-document-title">Receipt document</h2><p>{receiptDocument.fileName}</p></div><Button type="button" onClick={() => setReceiptDocument(null)}>Close</Button></header>
      <InvoiceDocumentViewer sourceUrl={`/api/office/invoice-extractions/${encodeURIComponent(receiptDocument.invoiceRunId)}/source`} mimeType={receiptDocument.mimeType} fileName={receiptDocument.fileName} title="Receipt document" />
    </ModalFrame> : null}
    <CheckpointCollection queue={queue} label="movements" pageSize={25} storageKey={`stock-movements:${scope}`} ariaLabel="Stock activity"
      renderItems={(entries) => <ol className="inventory-stock-activity-list">{entries.map(({ item, key, rowProps }) => <li {...rowProps} key={key}>
      <header><strong>{labels[item.type] || "Stock movement"}</strong><span className={Number(item.quantity) >= 0 ? "is-in" : "is-out"}>{item.quantity > 0 ? "+" : ""}{item.quantity} {item.uomCode}</span></header>
      <p>{item.workorderId ? <><a className="inventory-stock-activity-workorder" href={workorderHref(item.workorderId)}>{item.assetUnitNo || "Unit not recorded"}{item.workorderSerial ? ` · ${item.workorderSerial}` : ""}</a> · </> : null}{item.locationName} · <time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString()}</time></p>
      {item.repairOrder ? <p className="inventory-stock-activity-repair">{item.repairOrder}</p> : null}
      {item.receiptDocument?.sourceAvailable ? <button className="inventory-stock-activity-receipt" type="button" onClick={() => setReceiptDocument(item.receiptDocument)}>Open receipt</button> : item.receiptId ? <a className="inventory-stock-activity-receipt" href={receiptHref(item.receiptId)}>Open receipt</a> : null}
    </li>)}</ol>}><p className="inventory-detail-empty">{emptyMessage}</p></CheckpointCollection>
  </div>;
}
