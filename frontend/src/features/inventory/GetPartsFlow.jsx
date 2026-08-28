import { useId, useRef, useState } from "react";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";
import "./get-parts-flow.css";

function routeLabel(leg) { return leg.routeType === "destination_stock" ? "Available at this shop" : leg.state === "backordered" ? "Backordered" : `Transfer from ${leg.sourceLocationName || "another shop"}`; }

export function GetPartsFlow({ workorderId, catalogPartId = "", partLabel = "Selected part", destinationLocationId, defaultQuantity = 1, defaultUomCode = "ea", onComplete }) {
  const titleId = useId();
  const [form, setForm] = useState({ catalogPartId, quantity: String(defaultQuantity), uomCode: defaultUomCode, neededBy: "" });
  const [fulfillment, setFulfillment] = useState(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const requestKey = useRef(`get-parts-${crypto.randomUUID()}`);
  const approvalKey = useRef(`approve-parts-${crypto.randomUUID()}`);
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  async function recommend(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api("/api/office/part-fulfillments", { method: "POST", body: JSON.stringify({ ...form, workorderId, destinationLocationId, quantity: Number(form.quantity), neededBy: form.neededBy || null, idempotencyKey: requestKey.current }) });
      setFulfillment(result.fulfillment);
    } catch (nextError) { setError(nextError.message); } finally { setBusy(false); }
  }
  async function approve() {
    setBusy(true); setError("");
    try {
      const result = await api(`/api/office/part-fulfillments/${encodeURIComponent(fulfillment.id)}/approve`, { method: "POST", body: JSON.stringify({ recommendationVersion: fulfillment.recommendationVersion, idempotencyKey: approvalKey.current }) });
      setFulfillment(result.fulfillment); onComplete?.(result.fulfillment);
    } catch (nextError) { setError(nextError.message); } finally { setBusy(false); }
  }
  return <section className="get-parts-flow" aria-labelledby={titleId}>
    <header><span>Parts</span><h2 id={titleId}>Get parts</h2><p>We recommend an available route from current local stock.</p></header>
    {!fulfillment ? <form onSubmit={recommend}>
      <div className="get-parts-selected-part"><span>Part</span><strong>{partLabel}</strong></div>
      <label><span>Quantity</span><input type="number" min="0.001" step="0.001" value={form.quantity} onChange={update("quantity")} required /></label>
      <label><span>Unit</span><input value={form.uomCode} onChange={update("uomCode")} required /></label>
      <label><span>Needed by <small>Optional</small></span><input type="date" value={form.neededBy} onChange={update("neededBy")} /></label>
      <Button type="submit" variant="primary" disabled={busy}>{busy ? "Finding route…" : "Find parts"}</Button>
    </form> : <div className="get-parts-result" aria-live="polite">
      <strong>{fulfillment.state === "approved" ? "Recommendation approved" : routeLabel(fulfillment.legs[0])}</strong>
      {fulfillment.legs.map((leg) => <p key={leg.id || `${leg.routeType}-${leg.state}`}>{leg.quantity} {leg.uomCode} · {routeLabel(leg)}{leg.state === "ready_for_transfer" ? ". Transfer is not complete until a future confirmed movement." : ""}</p>)}
      {fulfillment.state === "approved" ? <p>Approval records this recommendation only. Stock is not reserved or moved yet.</p> : null}
      {fulfillment.state === "recommended" ? <Button type="button" variant="primary" onClick={approve} disabled={busy}>{busy ? "Approving…" : "Approve recommendation"}</Button> : null}
    </div>}
    {error ? <p className="ops-error" role="alert">{error}</p> : null}
  </section>;
}
