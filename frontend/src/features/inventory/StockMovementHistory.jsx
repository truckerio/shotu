import { useEffect, useState } from "react";
import { RefreshCw01 } from "@untitledui/icons";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";

const labels = { invoice_receipt: "Invoice delivery", direct_receipt: "Stock received", receipt_reversal: "Receipt reversed", issue: "Used on Workorder", return: "Returned to stock", transfer_in: "Transfer received", transfer_out: "Transfer dispatched", adjustment: "Count or correction" };
function receiptHref(receiptId) {
  return `?${new URLSearchParams({ view: "inventory", adminView: "inventory", inventorySection: "inbound", receiptId })}`;
}
function workorderHref(workorderId) {
  return `?${new URLSearchParams({ workorder: workorderId, section: "concern" })}`;
}

export function StockMovementHistory({ partId, locationId = "", view = "audit", emptyMessage = "No stock activity.", refreshKey = 0 }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { setPage(1); }, [partId, locationId, view, refreshKey]);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page) });
    if (locationId) params.set("locationId", locationId);
    if (view !== "audit") params.set("view", view);
    setLoading(true);
    setError("");
    api(`/api/office/inventory/parts/${partId}/movements?${params}`)
      .then((result) => { if (active) setData(result); })
      .catch((nextError) => { if (active) setError(nextError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [partId, locationId, view, page, refreshKey, reloadKey]);
  return <div className="inventory-stock-activity" aria-busy={loading}>
    {error ? <div className="inventory-stock-activity-error" role="alert"><p>{error}</p><Button type="button" icon={RefreshCw01} onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>Refresh</Button></div> : null}
    {loading ? <p role="status">Loading stock activity…</p> : null}
    {!loading && !error && data?.items.length === 0 ? <p className="inventory-detail-empty">{emptyMessage}</p> : null}
    {!loading && !error && data?.items.length ? <ol className="inventory-stock-activity-list">{data.items.map((item) => <li key={item.id}>
      <header><strong>{labels[item.type] || "Stock movement"}</strong><span className={Number(item.quantity) >= 0 ? "is-in" : "is-out"}>{item.quantity > 0 ? "+" : ""}{item.quantity} {item.uomCode}</span></header>
      <p>{item.workorderId ? <><a className="inventory-stock-activity-workorder" href={workorderHref(item.workorderId)}>{item.assetUnitNo || "Unit not recorded"}{item.workorderSerial ? ` · ${item.workorderSerial}` : ""}</a> · </> : null}{item.locationName} · <time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString()}</time></p>
      {item.repairOrder ? <p className="inventory-stock-activity-repair">{item.repairOrder}</p> : null}
      {item.receiptId ? <a className="inventory-stock-activity-receipt" href={receiptHref(item.receiptId)}>Open receipt</a> : null}
    </li>)}</ol> : null}
    {page > 1 || data?.hasMore ? <div className="inventory-stock-activity-pagination"><Button onClick={() => setPage((value) => value - 1)} disabled={loading || page === 1}>Previous</Button><span>Page {page}</span><Button onClick={() => setPage((value) => value + 1)} disabled={loading || !data?.hasMore}>Next</Button></div> : null}
  </div>;
}
