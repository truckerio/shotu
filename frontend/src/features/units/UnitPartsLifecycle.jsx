import { useEffect, useRef, useState } from "react";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";
import { createWorkorderSearch, workorderDetailSearch } from "../../app/routes/route-state.js";
import { assetReusePath, canReleaseCase, caseStage, clearReuseRecovery, eligibleRemovalWorkorders, lifecycleIdempotencyKey, restoreReuseRecovery, reuseOperationPath, reuseScope, saveReuseRecovery } from "./unit-parts-lifecycle-model.js";
import { ReuseSetup } from "./ReuseSetup.jsx";

function partLabel(part) {
  return [part.partNumber, part.description, part.serialNumber].filter(Boolean).join(" · ") || "Tracked part";
}

function workorderLabel(workorder) {
  return workorder.workorderSerial || workorder.serial || workorder.id;
}

function WorkorderLink({ workorder }) {
  const id = workorder?.workorderId || workorder?.id || workorder;
  const label = typeof workorder === "object" ? workorderLabel(workorder) : id;
  return id ? <a href={workorderDetailSearch(id)} aria-label={`Open workorder ${label}`}>{label}</a> : "not recorded";
}

function recoveryStorage() {
  try { return window.sessionStorage; }
  catch { return null; }
}

export function UnitPartsLifecycle({ unit, actorId = "", initialUsageId = "", initialWorkorderId = "", onChanged, onBusyChange }) {
  const scope = reuseScope(unit);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(null);
  const [draft, setDraft] = useState({ reason: "", ownership: "unknown", ownershipEvidence: "", evidence: "", inspectionEvidence: "", reviewReason: "" });
  const [pendingRequest, setPendingRequest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [needsReconcile, setNeedsReconcile] = useState(false);
  const keys = useRef(new Map());
  const openedInitialRef = useRef("");
  const loadControllerRef = useRef(null);
  const loadGenerationRef = useRef(0);
  const restoredRecoveryKeysRef = useRef(new Set());

  const hasScope = Boolean(scope.companyId && scope.locationId);
  const recoveryScope = { actorId, ...scope, assetId: unit?.id || "" };
  async function load() {
    if (!hasScope || !unit?.id) return;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    const generation = ++loadGenerationRef.current;
    loadControllerRef.current = controller;
    setLoading(true); setError("");
    try { const next = await api(assetReusePath(unit.id, scope), { signal: controller.signal }); if (generation === loadGenerationRef.current) setData(next); }
    catch (failure) { if (generation === loadGenerationRef.current && !controller.signal.aborted) { setData(null); setError(failure.message || "Could not load tracked parts."); } }
    finally { if (generation === loadGenerationRef.current) setLoading(false); }
  }

  useEffect(() => {
    setActive(null); setPendingRequest(null); setNeedsReconcile(false); setDraft({ reason: "", ownership: "unknown", ownershipEvidence: "", evidence: "", inspectionEvidence: "", reviewReason: "" });
    if (!hasScope || !unit?.id) return undefined;
    void load();
    const generation = loadGenerationRef.current;
    return () => {
      if (generation === loadGenerationRef.current) {
        loadGenerationRef.current += 1;
        loadControllerRef.current?.abort();
      }
    };
  }, [unit?.id, scope.companyId, scope.locationId]);

  useEffect(() => {
    if (!actorId || !hasScope || !unit?.id) return undefined;
    const command = restoreReuseRecovery(recoveryStorage(), recoveryScope, restoredRecoveryKeysRef.current);
    if (command) {
      setPendingRequest(command); setNeedsReconcile(true);
      setError("A previous custody request needs its outcome checked before any retry.");
    }
  }, [actorId, unit?.id, scope.companyId, scope.locationId]);

  useEffect(() => {
    if (!actorId || !hasScope || !unit?.id) return undefined;
    function warnBeforeUnload(event) {
      if (!pendingRequest || (!needsReconcile && !busy)) return;
      event.preventDefault(); event.returnValue = "A custody request outcome still needs checking.";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [actorId, unit?.id, scope.companyId, scope.locationId, pendingRequest, needsReconcile, busy]);

  useEffect(() => {
    const initial = `${unit?.id}:${initialUsageId}:${initialWorkorderId}`;
    if (!data || !initialUsageId || openedInitialRef.current === initial) return;
    const part = (data.installedParts || []).find((item) => item.usageId === initialUsageId);
    if (!part) return;
    openedInitialRef.current = initial;
    openForm("remove", { ...part, removalWorkorderId: part.status === "installed_pending_approval" ? initialWorkorderId : "" });
  }, [data, initialUsageId, initialWorkorderId, unit?.id]);

  useEffect(() => { onBusyChange?.(busy || Boolean(pendingRequest) || needsReconcile); }, [busy, pendingRequest, needsReconcile, onBusyChange]);

  function openForm(kind, item) {
    if (busy || pendingRequest) return;
    setPendingRequest(null); setNeedsReconcile(false); setError(""); setActive({ kind, item });
    setDraft({ reason: "", ownership: "unknown", ownershipEvidence: "", evidence: "", inspectionEvidence: "", reviewReason: "" });
  }
  function closeForm() { setActive(null); setPendingRequest(null); }

  async function submit(request = pendingRequest) {
    if (!request || busy || needsReconcile) return;
    saveReuseRecovery(recoveryStorage(), recoveryScope, request);
    setBusy(true); setError("");
    try {
      await api(request.path, { method: "POST", body: JSON.stringify(request.body) });
      clearReuseRecovery(recoveryStorage(), recoveryScope); setPendingRequest(null); closeForm(); await load(); await onChanged?.();
    } catch (failure) {
      const uncertain = !failure.status || failure.status >= 500;
      if (uncertain) {
        setPendingRequest(request); setNeedsReconcile(true);
        setError(`${failure.message || "The update result is unknown."} Check the saved request before retrying.`);
      } else {
        clearReuseRecovery(recoveryStorage(), recoveryScope); setPendingRequest(null); setNeedsReconcile(false);
        setError(`${failure.message || "The update could not be saved."} Correct the entry and try again.`);
      }
    } finally { setBusy(false); }
  }

  async function reconcile() {
    if (!pendingRequest || busy) return;
    setBusy(true); setError("");
    try {
      await api(reuseOperationPath(pendingRequest.body.idempotencyKey, scope));
      clearReuseRecovery(recoveryStorage(), recoveryScope); setPendingRequest(null); setNeedsReconcile(false); closeForm(); await load(); await onChanged?.();
    } catch (failure) {
      if (failure.code === "INVENTORY_REUSE_OPERATION_NOT_FOUND") { clearReuseRecovery(recoveryStorage(), recoveryScope); setNeedsReconcile(false); setError("No committed operation was found. You may retry the saved request."); }
      else setError(`${failure.message || "Could not check the request."} Do not retry until its status is known.`);
    }
    finally { setBusy(false); }
  }

  function remove() {
    const { item } = active;
    if (!draft.reason.trim() || !item.removalWorkorderId) return;
    const identity = `remove:${item.usageId}:${item.removalWorkorderId}:${draft.reason}:${draft.ownership}:${draft.ownershipEvidence}`;
    const request = {
      path: "/api/inventory-reuse/remove",
      body: { ...scope, usageId: item.usageId, removalWorkorderId: item.removalWorkorderId, reason: draft.reason.trim(), ownership: draft.ownership, ownershipEvidence: draft.ownershipEvidence.trim(), idempotencyKey: lifecycleIdempotencyKey(keys.current, identity) },
    };
    setPendingRequest(request); submit(request);
  }
  function receive() {
    if (!draft.evidence.trim()) return;
    const identity = `receive:${active.item.id}:${draft.evidence}`;
    const request = { path: `/api/inventory-reuse/${encodeURIComponent(active.item.id)}/receive`, body: { ...scope, evidence: draft.evidence.trim(), idempotencyKey: lifecycleIdempotencyKey(keys.current, identity) } };
    setPendingRequest(request); submit(request);
  }
  function review(decision) {
    if (!draft.inspectionEvidence.trim() || !draft.reviewReason.trim()) return;
    const identity = `review:${active.item.id}:${decision}:${draft.inspectionEvidence}:${draft.reviewReason}`;
    const request = { path: `/api/inventory-reuse/${encodeURIComponent(active.item.id)}/review`, body: { ...scope, decision, inspectionEvidence: draft.inspectionEvidence.trim(), reason: draft.reviewReason.trim(), idempotencyKey: lifecycleIdempotencyKey(keys.current, identity) } };
    setPendingRequest(request); submit(request);
  }

  if (!hasScope) return <p className="unit-parts-notice" role="status">Tracked parts are unavailable until this unit has a company and receiving location.</p>;
  if (loading && !data) return <p className="unit-parts-notice" role="status">Loading tracked parts…</p>;
  if (error && !data) return <div className="unit-parts-notice" role="alert"><p>{error}</p><Button type="button" onClick={load}>Try again</Button></div>;
  const installedParts = data?.installedParts || [];
  const pendingParts = installedParts.filter((part) => part.status === "installed_pending_approval");
  const approvedParts = installedParts.filter((part) => part.status !== "installed_pending_approval");
  const cases = data?.cases || [];
  const removalWorkorders = data?.removalWorkorders || [];
  const eligibleRemovalWorkordersForActive = active?.kind === "remove"
    ? eligibleRemovalWorkorders(active.item, removalWorkorders)
    : [];
  return <div className="unit-parts-lifecycle">
    {error ? <div className="unit-parts-error" role="alert"><span>{error}</span>{pendingRequest && needsReconcile ? <Button type="button" disabled={busy} onClick={reconcile}>Check saved request</Button> : null}{pendingRequest && !needsReconcile ? <Button type="button" disabled={busy} onClick={() => submit()}>Retry saved request</Button> : null}</div> : null}
    <section aria-labelledby="tracked-installed-parts"><div className="unit-parts-section-heading"><div><h4 id="tracked-installed-parts">Tracked installed parts</h4></div>{loading ? <span role="status">Refreshing…</span> : null}</div>
      {!approvedParts.length ? <p className="unit-parts-notice">No approved installed parts on this unit.</p> : <ul className="unit-parts-list">{approvedParts.map((part) => <li key={part.usageId}><div><strong>{partLabel(part)}</strong><span>Installed on <WorkorderLink workorder={part} /></span></div><Button type="button" disabled={busy || Boolean(pendingRequest) || !data.capabilities?.remove} onClick={() => openForm("remove", part)}>Remove</Button></li>)}</ul>}
    </section>
    {pendingParts.length ? <section aria-labelledby="pending-installations"><div className="unit-parts-section-heading"><div><h4 id="pending-installations">Pending installation</h4></div></div><ul className="unit-parts-list">{pendingParts.map((part) => <li key={part.usageId}><div><strong>{partLabel(part)}</strong><span>Original workorder <WorkorderLink workorder={part} /></span></div><Button type="button" disabled={busy || Boolean(pendingRequest) || !data.capabilities?.remove} onClick={() => openForm("remove", part)}>Remove</Button></li>)}</ul></section> : null}
    <section aria-labelledby="returned-parts"><div className="unit-parts-section-heading"><div><h4 id="returned-parts">Returned parts</h4></div></div>
      {!cases.length ? <p className="unit-parts-notice">No returned parts are awaiting custody or review.</p> : <ul className="unit-parts-list">{cases.map((caseItem) => <li key={caseItem.id}><div><strong>{[caseItem.partNumber, caseItem.description, caseItem.serialNumber].filter(Boolean).join(" · ") || "Returned part"}</strong><span>{caseStage(caseItem.status)} · original workorder <WorkorderLink workorder={{ workorderId: caseItem.originalWorkorderId, workorderSerial: caseItem.originalWorkorderSerial }} /></span></div>{caseItem.status === "awaiting_handoff" ? <Button type="button" disabled={busy || Boolean(pendingRequest) || !data.capabilities?.receive} onClick={() => openForm("receive", caseItem)}>Receive</Button> : null}{["received_pending_review", "hold"].includes(caseItem.status) ? <Button type="button" disabled={busy || Boolean(pendingRequest) || !data.capabilities?.release} onClick={() => openForm("review", caseItem)}>{caseItem.status === "hold" ? "Review again" : "Review"}</Button> : null}</li>)}</ul>}
      {data?.capabilities?.configure ? <ReuseSetup companyId={scope.companyId} locationId={scope.locationId} onSaved={load} /> : null}
    </section>
    {active?.kind === "remove" ? <section className="unit-parts-form" aria-label="Remove tracked part"><h4>1. Remove</h4><p>Original workorder: <WorkorderLink workorder={active.item} /></p><label>{active.item.status === "installed_pending_approval" ? "Active removal workorder" : "New removal workorder"}<Dropdown aria-label={active.item.status === "installed_pending_approval" ? "Active removal workorder" : "New removal workorder"} disabled={busy || Boolean(pendingRequest)} value={active.item.removalWorkorderId || ""} onChange={(event) => setActive((current) => ({ ...current, item: { ...current.item, removalWorkorderId: event.target.value } }))}><option value="">Select eligible workorder</option>{eligibleRemovalWorkordersForActive.map((workorder) => <option value={workorder.id} key={workorder.id}>{workorderLabel(workorder)}</option>)}</Dropdown></label>{!eligibleRemovalWorkordersForActive.length ? <p className="unit-parts-notice">Ask your office team to create or activate a workorder for this unit if you cannot create one. {!pendingRequest ? <a className="button secondary" href={createWorkorderSearch()}>Create workorder</a> : <span>Navigation stays unavailable until this custody request outcome is known.</span>}</p> : null}<label>Reason<textarea disabled={busy || Boolean(pendingRequest)} rows="2" value={draft.reason} onChange={(event) => setDraft((value) => ({ ...value, reason: event.target.value }))} /></label><label>Ownership<Dropdown aria-label="Part ownership" disabled={busy || Boolean(pendingRequest)} value={draft.ownership} onChange={(event) => setDraft((value) => ({ ...value, ownership: event.target.value }))}><option value="company">Company</option><option value="customer">Customer</option><option value="unknown">Unknown — cannot release</option></Dropdown></label><label>Ownership evidence <span>{draft.ownership === "company" ? "(required)" : "(optional)"}</span><input disabled={busy || Boolean(pendingRequest)} value={draft.ownershipEvidence} onChange={(event) => setDraft((value) => ({ ...value, ownershipEvidence: event.target.value }))} /></label><div><Button type="button" onClick={remove} disabled={busy || Boolean(pendingRequest) || !draft.reason.trim() || !active.item.removalWorkorderId || (draft.ownership === "company" && !draft.ownershipEvidence.trim())}>{busy ? "Saving…" : "Confirm removal"}</Button><Button type="button" disabled={busy || Boolean(pendingRequest)} onClick={closeForm}>Cancel</Button></div></section> : null}
    {active?.kind === "receive" ? <section className="unit-parts-form" aria-label="Receive returned part"><h4>2. Receive</h4><label>Receipt evidence<textarea disabled={busy || Boolean(pendingRequest)} rows="2" value={draft.evidence} onChange={(event) => setDraft((value) => ({ ...value, evidence: event.target.value }))} /></label><div><Button type="button" onClick={receive} disabled={busy || Boolean(pendingRequest) || !draft.evidence.trim()}>{busy ? "Saving…" : "Confirm receipt"}</Button><Button type="button" disabled={busy || Boolean(pendingRequest)} onClick={closeForm}>Cancel</Button></div></section> : null}
    {active?.kind === "review" ? <section className="unit-parts-form" aria-label="Review returned part"><h4>3. Review</h4><label>Inspection evidence<textarea disabled={busy || Boolean(pendingRequest)} rows="2" value={draft.inspectionEvidence} onChange={(event) => setDraft((value) => ({ ...value, inspectionEvidence: event.target.value }))} /></label><label>Review reason <span>(required)</span><textarea disabled={busy || Boolean(pendingRequest)} rows="2" value={draft.reviewReason} onChange={(event) => setDraft((value) => ({ ...value, reviewReason: event.target.value }))} /></label><div><Button type="button" onClick={() => review("release")} disabled={busy || Boolean(pendingRequest) || !canReleaseCase(active.item, data.capabilities) || !draft.inspectionEvidence.trim() || !draft.reviewReason.trim()}>Release to stock</Button><Button type="button" onClick={() => review("hold")} disabled={busy || Boolean(pendingRequest) || !draft.inspectionEvidence.trim() || !draft.reviewReason.trim()}>Hold part</Button><Button type="button" disabled={busy || Boolean(pendingRequest)} onClick={closeForm}>Cancel</Button></div></section> : null}
  </div>;
}
