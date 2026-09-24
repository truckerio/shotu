import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Check, XClose } from "@untitledui/icons";
import { Heading } from "react-aria-components";
import { Button } from "../../components/ui/Button.jsx";
import { IconButton } from "../../components/ui/IconButton.jsx";
import { ModalFrame } from "../../components/ui/ModalFrame.jsx";
import { api } from "../../lib/api.js";
import { isStalePositionError } from "./inventory-location-model.js";
import "./inventory-locations-workspace.css";

function countKey(locationId, positionId) {
  return `inventory-position-count:${locationId}:${positionId}`;
}

function readCountId(key) {
  try { return sessionStorage.getItem(key) || ""; } catch { return ""; }
}

function saveCountId(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* optional storage */ }
}

function clearCountId(key) {
  try { sessionStorage.removeItem(key); } catch { /* optional storage */ }
}

function quantity(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(Number(value || 0));
}

function selectedFacts(count) {
  const lines = (count?.lines || []).filter((line) => line.observedQuantity !== null && line.observedQuantity !== undefined);
  const serialGroups = (count?.serialGroups || []).filter((group) => group.observedCount > 0);
  return {
    lines,
    serialGroups,
    selectedCount: lines.length + serialGroups.length,
    untouchedCount: Math.max(0, (count?.lines?.length || 0) + (count?.serialGroups?.length || 0) - lines.length - serialGroups.length),
    serialComplete: serialGroups.every((group) => group.observedCount === group.expectedCount),
  };
}

export const PositionCountPanel = forwardRef(function PositionCountPanel({
  location,
  position,
  initialOpen = false,
  canApplyInventoryCount = false,
  onModeChange,
  onChanged,
}, actionRef) {
  const locationId = location?.id || location?.locationId || "";
  const positionId = position?.id || position?.positionId || "";
  const storageKey = countKey(locationId, positionId);
  const [count, setCount] = useState(null);
  const [expanded, setExpanded] = useState(initialOpen);
  const [activeLineId, setActiveLineId] = useState("");
  const [activeSerialPartId, setActiveSerialPartId] = useState("");
  const [draft, setDraft] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [serialInputMode, setSerialInputMode] = useState("scanner");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const keys = useRef(new Map());
  const initialStartRequested = useRef(false);
  const activeStorageKey = useRef(storageKey);
  const facts = selectedFacts(count);

  useEffect(() => {
    activeStorageKey.current = storageKey;
    return () => { activeStorageKey.current = ""; };
  }, [storageKey]);

  function isCurrent(requestKey) {
    return activeStorageKey.current === requestKey;
  }

  function countMatchesPosition(next) {
    return (!next?.positionId || next.positionId === positionId)
      && (!next?.locationId || next.locationId === locationId);
  }

  const load = useCallback(async (countId = readCountId(storageKey)) => {
    if (!countId) return;
    const requestKey = storageKey;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/api/office/inventory/position-counts/${encodeURIComponent(countId)}`);
      if (!isCurrent(requestKey)) return;
      if (!countMatchesPosition(result.count)) {
        clearCountId(requestKey);
        setCount(null);
        setError("The saved physical count belongs to another storage location.");
        return;
      }
      setCount(result.count || null);
    } catch (next) {
      if (!isCurrent(requestKey)) return;
      clearCountId(requestKey);
      setCount(null);
      setError(next.message || "The saved count could not be reopened.");
    } finally {
      if (isCurrent(requestKey)) setBusy(false);
    }
  }, [storageKey, locationId, positionId]);

  useEffect(() => { setCount(null); setError(""); load(); }, [load]);
  useEffect(() => {
    onModeChange?.({ active: expanded, selectedCount: facts.selectedCount, busy });
  }, [busy, expanded, facts.selectedCount, onModeChange]);

  async function start() {
    const requestKey = storageKey;
    const identity = `position-count-start:${locationId}:${positionId}`;
    const idempotencyKey = keys.current.get(identity) || crypto.randomUUID();
    keys.current.set(identity, idempotencyKey);
    setBusy(true);
    setError("");
    try {
      const result = await api(`/api/office/inventory/locations/${encodeURIComponent(locationId)}/position-counts`, {
        method: "POST",
        body: JSON.stringify({ positionId, idempotencyKey }),
      });
      if (!isCurrent(requestKey)) return;
      if (!countMatchesPosition(result.count)) {
        setError("The physical count response belongs to another storage location.");
        return;
      }
      setCount(result.count);
      setExpanded(true);
      saveCountId(requestKey, result.count.id);
      keys.current.delete(identity);
    } catch (next) {
      if (isCurrent(requestKey)) setError(next.message || "Count could not be started. Retry keeps the same request.");
    } finally {
      if (isCurrent(requestKey)) setBusy(false);
    }
  }

  useEffect(() => {
    if (!initialOpen || count || busy || readCountId(storageKey) || initialStartRequested.current) return;
    initialStartRequested.current = true;
    start();
  }, [busy, count, initialOpen, storageKey]);

  useImperativeHandle(actionRef, () => ({
    open() {
      if (busy) return;
      if (count && ["open", "ready"].includes(count.status)) setExpanded(true);
      else start();
    },
    exit() {
      if (busy) return;
      setActiveLineId("");
      setActiveSerialPartId("");
      setReviewOpen(false);
      setExpanded(false);
    },
    review() {
      if (!busy && facts.selectedCount > 0) setReviewOpen(true);
    },
  }), [busy, count, facts.selectedCount, locationId, positionId, storageKey]);

  async function saveLine(line, nextQuantity = draft) {
    const observedQuantity = Number(nextQuantity);
    if (!Number.isFinite(observedQuantity) || observedQuantity < 0) {
      setError("Enter a counted quantity of zero or more.");
      return;
    }
    const requestKey = storageKey;
    const identity = `position-count-line:${count.id}:${line.id}:${line.version}:${observedQuantity}`;
    const idempotencyKey = keys.current.get(identity) || crypto.randomUUID();
    keys.current.set(identity, idempotencyKey);
    setBusy(true);
    setError("");
    try {
      const result = await api(`/api/office/inventory/position-counts/${encodeURIComponent(count.id)}/lines/${encodeURIComponent(line.id)}`, {
        method: "PUT",
        body: JSON.stringify({ expectedVersion: line.version, observedQuantity, idempotencyKey }),
      });
      if (!isCurrent(requestKey)) return;
      setCount(result.count);
      setActiveLineId("");
      setDraft("");
      keys.current.delete(identity);
    } catch (next) {
      if (isCurrent(requestKey)) setError(isStalePositionError(next) ? "This part changed elsewhere. Reload the count before saving it." : next.message || "Counted quantity could not be saved.");
    } finally {
      if (isCurrent(requestKey)) setBusy(false);
    }
  }

  async function observeIdentity(event) {
    event.preventDefault();
    const normalized = serialNumber.trim();
    if (!normalized) return;
    const requestKey = storageKey;
    const identity = `position-count-identity:${count.id}:${count.version}:${serialInputMode}:${normalized}`;
    const idempotencyKey = keys.current.get(identity) || crypto.randomUUID();
    keys.current.set(identity, idempotencyKey);
    setBusy(true);
    setError("");
    try {
      const result = await api(`/api/office/inventory/position-counts/${encodeURIComponent(count.id)}/identities`, {
        method: "PUT",
        body: JSON.stringify({ serialNumber: normalized, inputMode: serialInputMode, expectedVersion: count.version, idempotencyKey }),
      });
      if (!isCurrent(requestKey)) return;
      setCount(result.count);
      setSerialNumber("");
      keys.current.delete(identity);
    } catch (next) {
      const messages = {
        INVENTORY_POSITION_SERIAL_NOT_FOUND: `${normalized} was not found in this location.`,
        INVENTORY_POSITION_SERIAL_WRONG_POSITION: `${normalized} belongs to another location.`,
      };
      if (isCurrent(requestKey)) setError(messages[next.code] || next.message || "The identity could not be confirmed.");
    } finally {
      if (isCurrent(requestKey)) setBusy(false);
    }
  }

  async function applyReady(nextCount) {
    const identity = `position-count-apply:${nextCount.id}:${nextCount.version}`;
    const idempotencyKey = keys.current.get(identity) || crypto.randomUUID();
    keys.current.set(identity, idempotencyKey);
    return api(`/api/office/inventory/position-counts/${encodeURIComponent(nextCount.id)}/apply`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion: nextCount.version, idempotencyKey }),
    });
  }

  async function finishReview() {
    if (!count || facts.selectedCount === 0 || !facts.serialComplete) return;
    const requestKey = storageKey;
    setBusy(true);
    setError("");
    try {
      let result = { count };
      if (count.status === "open") {
        const identity = `position-count-submit:${count.id}:${count.version}`;
        const idempotencyKey = keys.current.get(identity) || crypto.randomUUID();
        keys.current.set(identity, idempotencyKey);
        result = await api(`/api/office/inventory/position-counts/${encodeURIComponent(count.id)}/submit`, {
          method: "POST",
          body: JSON.stringify({ expectedVersion: count.version, idempotencyKey }),
        });
      }
      if (canApplyInventoryCount && result.count?.status === "ready") result = await applyReady(result.count);
      if (!isCurrent(requestKey)) return;
      setCount(result.count);
      setReviewOpen(false);
      if (result.count?.status === "needs_recount") {
        setError("A selected part moved after it was counted. Start a recount before applying any change.");
        return;
      }
      setExpanded(false);
      clearCountId(requestKey);
      onChanged?.();
    } catch (next) {
      if (isCurrent(requestKey)) setError(isStalePositionError(next) ? "Inventory changed after this part was counted. Reload and count that part again." : next.message || "The physical count could not be completed.");
    } finally {
      if (isCurrent(requestKey)) setBusy(false);
    }
  }

  if (!positionId || position?.canStore !== true || !expanded) return null;
  if (!count) return <div className="position-count-starting" role="status">Starting physical count…</div>;

  return <>
    {error ? <p className="ops-error position-count-error" role="alert">{error}</p> : null}
    {count.status === "needs_recount" ? <div className="position-count-recount" role="alert"><p>This selective count is read-only because one of its selected parts changed.</p><Button type="button" variant="primary" onClick={start} disabled={busy}>Start recount</Button></div> : null}
    <div className="inventory-location-stock-list inventory-location-count-list" aria-label="Parts available for selective physical count">
      {(count.lines || []).map((line) => {
        const observed = line.observedQuantity !== null && line.observedQuantity !== undefined;
        const editing = activeLineId === line.id;
        return <article className={`inventory-location-count-row${observed ? " is-counted" : ""}`} key={line.id}>
          <span className="inventory-location-count-part"><strong>{line.partNumber || "Part"}</strong><small>{line.description || "No description"}</small></span>
          {editing ? <form className="inventory-location-count-editor" onSubmit={(event) => { event.preventDefault(); saveLine(line); }}>
            <label><input aria-label={`Counted quantity for ${line.partNumber}`} autoFocus type="number" min="0" step={line.trackingMode === "quantity" ? "1" : String(1 / (10 ** Number(line.decimalScale || 3)))} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} /></label>
            <span>{line.uomCode}</span>
            <IconButton type="submit" icon={Check} label={`Save counted quantity for ${line.partNumber}`} disabled={busy || draft === ""} />
            <IconButton type="button" icon={XClose} label={observed ? `Reset counted quantity for ${line.partNumber} to on hand` : `Cancel counting ${line.partNumber}`} onClick={() => { if (observed) saveLine(line, line.expectedQuantity); else { setActiveLineId(""); setDraft(""); setError(""); } }} disabled={busy} />
          </form> : observed ? <button type="button" className="inventory-location-count-summary" onClick={() => { setActiveLineId(line.id); setActiveSerialPartId(""); setDraft(String(line.observedQuantity)); }} disabled={busy || count.status !== "open"} aria-label={`Edit physical count for ${line.partNumber}`}>
            <span><small>Counted</small><strong>{quantity(line.observedQuantity)} {line.uomCode}</strong></span><span><small>On hand</small><strong>{quantity(line.expectedQuantity)} {line.uomCode}</strong></span><span><small>Variance</small><strong className={Number(line.difference) === 0 ? "is-even" : "is-different"}>{Number(line.difference) > 0 ? "+" : ""}{quantity(line.difference)}</strong></span>
          </button> : <button type="button" className="inventory-location-count-trigger" onClick={() => { setActiveLineId(line.id); setActiveSerialPartId(""); setDraft(""); setError(""); }} disabled={busy || count.status !== "open"}><span>{quantity(line.expectedQuantity)} {line.uomCode}</span><small>Count this part</small></button>}
        </article>;
      })}
      {(count.serialGroups || []).map((group) => {
        const editing = activeSerialPartId === group.partId;
        const selected = group.observedCount > 0;
        return <article className={`inventory-location-count-row inventory-location-serial-count-row${selected ? " is-counted" : ""}`} key={group.partId}>
          <span className="inventory-location-count-part"><strong>{group.partNumber || "Serialized part"}</strong><small>{group.description || "Exact identity tracking"}</small></span>
          <button type="button" className="inventory-location-count-trigger" onClick={() => { setActiveSerialPartId(editing ? "" : group.partId); setActiveLineId(""); }} disabled={busy || count.status !== "open"}><span>{group.observedCount} of {group.expectedCount}</span><small>{group.observedCount === group.expectedCount ? "Identities confirmed" : "Count identities"}</small></button>
          {editing ? <div className="inventory-location-serial-editor">
            <div className="inventory-location-serial-units">{group.units.map((unit) => <span className={unit.observed ? "is-confirmed" : ""} key={unit.unitId}>{unit.serialNumber}<small>{unit.observed ? "Confirmed" : "Expected"}</small></span>)}</div>
            <form onSubmit={observeIdentity}><div role="group" aria-label="Identity entry method"><button type="button" aria-pressed={serialInputMode === "scanner"} onClick={() => setSerialInputMode("scanner")}>Scanner</button><button type="button" aria-pressed={serialInputMode === "manual"} onClick={() => setSerialInputMode("manual")}>Manual</button></div><label><input aria-label="Serial number" autoFocus autoComplete="off" value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} disabled={busy} /></label><Button type="submit" disabled={busy || !serialNumber.trim()}>Confirm identity</Button></form>
          </div> : null}
        </article>;
      })}
    </div>
    <p className="position-count-help">Select only the parts you physically checked. Every untouched part stays unchanged.</p>
    {reviewOpen ? <ModalFrame overlayClassName="position-count-review-overlay" modalClassName="position-count-review-modal" dialogClassName="position-count-review-dialog" ariaLabelledBy={`position-count-review-${count.id}`} isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) setReviewOpen(false); }}>
      <header><div><Heading slot="title" id={`position-count-review-${count.id}`}>Review physical count</Heading><p>Only these {facts.selectedCount} {facts.selectedCount === 1 ? "part" : "parts"} will be recorded. {facts.untouchedCount} untouched {facts.untouchedCount === 1 ? "part stays" : "parts stay"} unchanged.</p></div><IconButton icon={XClose} label="Close physical count review" onClick={() => setReviewOpen(false)} disabled={busy} /></header>
      <div className="position-count-review-lines">
        {facts.lines.map((line) => <div key={line.id}><span><strong>{line.partNumber}</strong><small>{line.description}</small></span><span><small>On hand</small>{quantity(line.expectedQuantity)} {line.uomCode}</span><span><small>Counted</small>{quantity(line.observedQuantity)} {line.uomCode}</span><span><small>Variance</small><strong className={Number(line.difference) === 0 ? "is-even" : "is-different"}>{Number(line.difference) > 0 ? "+" : ""}{quantity(line.difference)}</strong></span></div>)}
        {facts.serialGroups.map((group) => <div key={group.partId}><span><strong>{group.partNumber}</strong><small>{group.description}</small></span><span><small>On hand</small>{group.expectedCount} ea</span><span><small>Confirmed</small>{group.observedCount} ea</span><span><small>Variance</small>{group.observedCount - group.expectedCount}</span></div>)}
      </div>
      {!facts.serialComplete ? <p className="ops-error" role="alert">Finish confirming every identity for each selected serialized part before continuing.</p> : null}
      <footer><Button type="button" onClick={() => setReviewOpen(false)} disabled={busy}>Keep counting</Button><Button type="button" variant="primary" onClick={finishReview} disabled={busy || !facts.serialComplete}>{busy ? "Saving…" : canApplyInventoryCount ? `Apply ${facts.selectedCount} ${facts.selectedCount === 1 ? "count" : "counts"}` : "Submit for Admin review"}</Button></footer>
    </ModalFrame> : null}
  </>;
});
