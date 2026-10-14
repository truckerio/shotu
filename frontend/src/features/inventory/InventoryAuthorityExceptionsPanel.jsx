import { useCallback, useEffect, useRef, useState } from "react";
import { useCheckpointPages } from "../../components/operations/useCheckpointPages.js";
import { Button } from "../../components/ui/Button.jsx";
import { CheckpointCollection } from "../../components/ui/CheckpointCollection.jsx";
import { api } from "../../lib/api.js";

const transientKeys = new Map();
function acknowledgeKey(actorId, id, reason) {
  const identity = `authority-ack:${actorId || "session"}:${id}:${reason}`;
  if (transientKeys.has(identity)) return transientKeys.get(identity);
  try {
    const stored = window.sessionStorage.getItem(identity);
    if (stored) { transientKeys.set(identity, stored); return stored; }
    const next = `authority-ack-${crypto.randomUUID()}`;
    window.sessionStorage.setItem(identity, next); transientKeys.set(identity, next); return next;
  } catch {
    const next = `authority-ack-${crypto.randomUUID()}`;
    transientKeys.set(identity, next); return next;
  }
}
function clearAcknowledgeKey(actorId, id, reason) {
  const identity = `authority-ack:${actorId || "session"}:${id}:${reason}`;
  transientKeys.delete(identity);
  try { window.sessionStorage.removeItem(identity); } catch { /* in-memory fallback already cleared */ }
}

export function InventoryAuthorityExceptionsPanel({ actorId = "" }) {
  const [error, setError] = useState(""); const [selected, setSelected] = useState(null); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [refreshKey, setRefreshKey] = useState(0);
  const reasonRef = useRef(null);
  const fetchPage = useCallback(async (page, { signal }) => { const result = await api(`/api/office/inventory/authority-exceptions?page=${page}&limit=25`, { signal }); const total = Number(result.total) || 0; const limit = Number(result.limit) || 25; return { items: result.items || [], page: Number(result.page) || page, total, pageCount: Math.max(1, Math.ceil(total / limit)) }; }, []);
  const queue = useCheckpointPages({ queryKey: "inventory-authority-exceptions", fetchPage, refreshKey, getItemKey: (item) => item.id });
  useEffect(() => { if (selected) window.requestAnimationFrame(() => reasonRef.current?.focus()); }, [selected]);
  function refresh() { setError(""); setRefreshKey((value) => value + 1); }
  async function acknowledge(event) { event.preventDefault(); if (!reason.trim()) return; const submittedReason = reason.trim(); setBusy(true); setError(""); try { await api(`/api/office/inventory/authority-exceptions/${encodeURIComponent(selected.id)}/resolve`, { method: "POST", body: JSON.stringify({ action: "acknowledge", reason: submittedReason, idempotencyKey: acknowledgeKey(actorId, selected.id, submittedReason) }) }); clearAcknowledgeKey(actorId, selected.id, submittedReason); setSelected(null); setReason(""); setRefreshKey((value) => value + 1); } catch (next) { setError(next.message || "Could not acknowledge this exception."); } finally { setBusy(false); } }
  return <section className="inventory-authority-exceptions" aria-labelledby="inventory-authority-title"><header><div><h2 id="inventory-authority-title">Reconciliation exceptions</h2><p>Review catalog authority conflicts. Acknowledging records the reason only; it never changes stock.</p></div><Button type="button" onClick={refresh} disabled={queue.loading || queue.loadingMore}>Refresh</Button></header>{error ? <p role="alert" className="ops-error">{error}</p> : null}<CheckpointCollection queue={queue} label="exceptions" pageSize={25} storageKey={`inventory-authority-exceptions:${actorId || "session"}`} ariaLabel="Reconciliation exceptions" getItemKey={(item) => item.id} renderItems={(entries) => <div className="inventory-authority-list">{entries.map(({ item, key, rowProps }) => <article {...rowProps} key={key}><div><strong>{item.requestedPartNumber}</strong><small>Requested: {item.requestedUomCode} · {item.locationName}</small><small>Source: {item.sourcePartNumber || "No matching source"} · {item.sourceUomCode || "No UOM"}</small><small>Suppressed provider quantity: {item.quantityOnHand} · not local availability · Reserved blocker: {item.quantityReserved}</small></div><Button type="button" onClick={() => setSelected(item)} disabled={item.quantityReserved > 0}>Acknowledge</Button>{item.quantityReserved > 0 ? <p role="status">Reserved stock blocks acknowledgement until reservations are released.</p> : null}</article>)}</div>}><p className="inventory-empty">No reconciliation exceptions.</p></CheckpointCollection>{selected ? <form className="inventory-authority-reason" onSubmit={acknowledge}><h3>Acknowledge {selected.requestedPartNumber}</h3><p>This records reconciliation context only. No stock quantities will change.</p><label>Reason (required)<textarea ref={reasonRef} value={reason} onChange={(event) => setReason(event.target.value)} minLength="2" maxLength="500" required disabled={busy} /></label><div className="inventory-request-actions"><Button type="button" onClick={() => setSelected(null)} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || !reason.trim()}>Acknowledge without stock changes</Button></div></form> : null}</section>;
}
