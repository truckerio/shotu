import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.js";
import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { Button } from "../../components/ui/Button.jsx";
import { InspectionDeferralFields } from "./InspectionDeferralFields.jsx";
import { deferralIsComplete, deferralPayload, emptyDeferral, MAINTENANCE_LABELS, maintenanceEndpoint, maintenanceTriggerLabel } from "./inspection-maintenance-model.js";
import "./inspection-maintenance.css";

function readingTime(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.valueOf()) ? date.toLocaleString() : "Observation time unknown";
}

export function InspectionMaintenancePanel({ recordKind, recordId, unitType = "Truck", refreshKey = "" }) {
  const endpoint = maintenanceEndpoint(recordKind, recordId);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [reason, setReason] = useState("");
  const [policy, setPolicy] = useState(emptyDeferral);
  const [readingOpen, setReadingOpen] = useState(false);
  const [miles, setMiles] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [readingReason, setReadingReason] = useState("");
  const [feedback, setFeedback] = useState("");
  const generation = useRef(0);
  const loadSequence = useRef(0);
  const requestKeys = useRef(new Map());
  const editingRef = useRef(false);
  editingRef.current = Boolean(editing || readingOpen || busy);

  const reload = useCallback(async ({ signal } = {}) => {
    if (!endpoint) return;
    const current = generation.current;
    const sequence = ++loadSequence.current;
    try {
      const result = await api(endpoint, { signal });
      if (signal?.aborted || generation.current !== current || loadSequence.current !== sequence) return false;
      setData(result); setError("");
      return true;
    } catch (failure) {
      if (signal?.aborted || generation.current !== current || loadSequence.current !== sequence) return false;
      throw failure;
    }
  }, [endpoint]);

  useEffect(() => {
    generation.current += 1;
    setData(null); setError(""); setEditing(null); setReadingOpen(false); setFeedback(""); setBusy(false); setReason(""); setPolicy(emptyDeferral()); setMiles(""); setObservedAt(""); setReadingReason(""); requestKeys.current.clear();
    return () => { generation.current += 1; };
  }, [reload]);

  useEffect(() => {
    const controller = new AbortController();
    const scope = generation.current;
    reload({ signal: controller.signal }).catch(failure => { if (!controller.signal.aborted && generation.current === scope && failure.name !== "AbortError") setError(failure.message || "Maintenance reminders unavailable."); });
    return () => controller.abort();
  }, [reload, refreshKey]);

  useAutomaticRefresh(async ({ signal }) => { if (!editingRef.current) await reload({ signal }); }, { enabled: Boolean(endpoint) });

  function idempotency(body, operation = "mileage") {
    const identity = JSON.stringify([endpoint, operation, body]);
    if (!requestKeys.current.has(identity)) requestKeys.current.set(identity, `maintenance-${crypto.randomUUID()}`);
    return { ...body, idempotencyKey: requestKeys.current.get(identity) };
  }

  function edit(item, action) {
    setEditing({ item, action }); setReason(""); setPolicy({ ...emptyDeferral(), ...item.deferral, reason: "" }); setError(""); setFeedback("");
  }

  async function submitAction() {
    if (!editing) return;
    const { item, action } = editing;
    const scope = generation.current;
    loadSequence.current += 1;
    setBusy(true); setError("");
    try {
      const body = { expectedVersion: item.version, ...(action === "defer" ? { reason: policy.reason.trim(), deferral: deferralPayload(policy) } : action === "verify" ? { reason: reason.trim() } : {}) };
      await api(`/api/inspections/${encodeURIComponent(item.inspectionId)}/follow-ups/${encodeURIComponent(item.findingId)}/actions/${action}`, { method: "POST", body: JSON.stringify(idempotency(body, `${item.inspectionId}:${item.findingId}:${action}`)) });
      if (generation.current !== scope) return;
      setEditing(null); setFeedback(action === "create-workorder" ? "Repair planned in workorder. Verification still required." : action === "verify" ? "Resolution recorded." : "New review trigger recorded.");
      await reload();
    } catch (failure) { if (generation.current === scope) setError(failure.message || "Unable to update maintenance issue."); }
    finally { if (generation.current === scope) setBusy(false); }
  }

  async function acceptProvider() {
    const scope = generation.current;
    loadSequence.current += 1;
    setBusy(true); setError("");
    try {
      await api(`/api/inspections/${encodeURIComponent(recordId)}/mileage/provider`, { method: "POST", body: JSON.stringify(idempotency({ expectedVersion: data.mileage.version, reason: "Reviewed and accepted current Samsara odometer reading" }, "accept-provider")) });
      if (generation.current !== scope) return;
      setFeedback("Samsara mileage accepted. Prior manual reading remains in Activity."); await reload();
    } catch (failure) { if (generation.current === scope) setError(failure.message || "Unable to accept provider mileage."); }
    finally { if (generation.current === scope) setBusy(false); }
  }

  async function saveMileage(event) {
    event.preventDefault();
    const scope = generation.current;
    loadSequence.current += 1;
    setBusy(true); setError("");
    try {
      const date = new Date(observedAt);
      if (!observedAt || !Number.isFinite(date.valueOf()) || !String(miles).trim() || !Number.isFinite(Number(miles)) || Number(miles) < 0 || readingReason.trim().length < 3) throw new Error("Enter mileage, observation time, and correction reason.");
      const saved = await api(`/api/inspections/${encodeURIComponent(recordId)}/mileage`, { method: "POST", body: JSON.stringify(idempotency({ expectedVersion: data.mileage?.version ?? 0, miles: Number(miles), observedAt: date.toISOString(), reason: readingReason.trim() })) });
      if (generation.current !== scope) return;
      setReadingOpen(false); setReadingReason(""); setFeedback(saved.mileage?.historical ? "Historical mileage recorded. Current unit mileage unchanged." : "Mileage recorded with correction history."); await reload();
    } catch (failure) { if (generation.current === scope) setError(failure.message || "Unable to record mileage."); }
    finally { if (generation.current === scope) setBusy(false); }
  }

  if (!endpoint) return null;
  const items = data?.items || [];
  const mileage = data?.mileage;
  const canRecordMileage = recordKind === "inspection" && data?.canRecordMileage;
  return <section className="inspection-maintenance" aria-label="Maintenance to review">
    <div className="maintenance-heading"><h3>Maintenance to review</h3><Button type="button" disabled={busy} onClick={() => reload().catch(failure => setError(failure.message))}>Refresh</Button></div>
    {error ? <p role="alert" className="inspection-action-error">{error}</p> : null}
    {feedback ? <p role="status">{feedback}</p> : null}
    {!data && !error ? <p role="status">Checking previous issues and upcoming maintenance…</p> : null}
    {data && mileage && unitType !== "Trailer" ? <div className="maintenance-mileage"><strong>{mileage.miles == null ? "Mileage unavailable" : `${Number(mileage.miles).toLocaleString()} mi`}</strong><span>{mileage.source ? mileage.source.replaceAll("_", " ") : "No confirmed source"} · {readingTime(mileage.observedAt)}</span>{mileage.state !== "fresh" ? <strong>Reading {mileage.state || "unknown"} — verify mileage</strong> : null}{mileage.providerMiles != null && (mileage.state === "conflict" || mileage.source === "manual") ? <span>Samsara reports {Number(mileage.providerMiles).toLocaleString()} mi · {readingTime(mileage.providerObservedAt)}. Review before accepting.</span> : null}{canRecordMileage && mileage.providerMiles != null && mileage.source === "manual" ? <Button type="button" disabled={busy} onClick={acceptProvider}>Use reviewed Samsara mileage</Button> : null}{canRecordMileage ? <Button type="button" disabled={busy} onClick={() => { setReadingOpen(!readingOpen); setMiles(mileage.miles ?? ""); setObservedAt(""); setError(""); }}>Record dashboard mileage</Button> : null}</div> : null}
    {readingOpen ? <form className="maintenance-reading-form" onSubmit={saveMileage}>
      <label>Dashboard miles<input type="number" min="0" max="10000000" step="0.1" inputMode="decimal" required value={miles} onChange={event => setMiles(event.target.value)} /></label>
      <label>When observed<input type="datetime-local" step="1" required value={observedAt} onChange={event => setObservedAt(event.target.value)} /></label>
      <label>Reason for reading/correction<textarea required minLength="3" maxLength="1000" rows="2" value={readingReason} onChange={event => setReadingReason(event.target.value)} /></label>
      <small>Saved as new evidence with your name. Existing Samsara and inspection readings remain in history.</small>
      <div className="maintenance-actions"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save mileage"}</Button><Button type="button" disabled={busy} onClick={() => setReadingOpen(false)}>Cancel</Button></div>
    </form> : null}
    {data && !items.length ? <p>No open deferred inspection issues.</p> : null}
    {items.map(item => <article key={item.id || item.findingId} className={`maintenance-item is-${item.dueState || "upcoming"}`}>
      <div><strong>{MAINTENANCE_LABELS[item.dueState] || "Review required"}</strong><p>{item.note}</p></div>
      <small>{item.inspectionNumber || "Original inspection"} · {maintenanceTriggerLabel(item.deferral)}</small>
      {item.deferral?.reason ? <p>Deferred: {item.deferral.reason}</p> : null}
      {Number.isFinite(item.remainingMiles) ? <span>{item.remainingMiles >= 0 ? `${item.remainingMiles.toLocaleString()} mi remaining` : `${Math.abs(item.remainingMiles).toLocaleString()} mi overdue`}</span> : null}
      {item.workorderStatus ? <small>Workorder: {item.workorderStatus.replaceAll("_", " ")}</small> : null}
      {item.deferralCount > 1 ? <small>Deferred {item.deferralCount} times. Original issue remains open.</small> : null}
      {(item.canManage ?? data.canManage) && editing?.item.id !== item.id ? <div className="maintenance-actions">
        {(item.canManageWorkorders ?? data.canManageWorkorders) && !["repair_planned", "verification_required"].includes(item.dueState) ? <Button type="button" disabled={busy} onClick={() => edit(item, "create-workorder")}>Plan repair</Button> : null}
        {!["repair_planned", "verification_required"].includes(item.dueState) ? <Button type="button" disabled={busy} onClick={() => edit(item, "defer")}>Defer again</Button> : null}
        {item.dueState !== "repair_planned" ? <Button type="button" disabled={busy} onClick={() => edit(item, "verify")}>Verify resolved</Button> : null}
      </div> : null}
      {editing?.item.id === item.id ? <div className="maintenance-edit">
        {editing.action === "defer" ? <InspectionDeferralFields unitType={unitType} value={policy} onChange={value => setPolicy(value)} /> : editing.action === "verify" ? <label>What was verified?<textarea rows="2" minLength="2" maxLength="2000" value={reason} onChange={event => setReason(event.target.value)} /></label> : <p>Create or reuse an eligible workorder for this unit. Linking records the repair plan; issue remains open until verified.</p>}
        <div className="maintenance-actions"><Button type="button" disabled={busy || (editing.action === "defer" ? !deferralIsComplete(policy, unitType) : editing.action === "verify" ? reason.trim().length < 2 : false)} onClick={submitAction}>{busy ? "Saving…" : editing.action === "create-workorder" ? "Plan repair" : "Save decision"}</Button><Button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button></div>
      </div> : null}
    </article>)}
  </section>;
}
