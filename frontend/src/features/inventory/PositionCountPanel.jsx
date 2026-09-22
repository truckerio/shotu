import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button.jsx";
import { PartCatalogCombobox } from "../../components/workorders/part-requests/PartCatalogCombobox.jsx";
import { api } from "../../lib/api.js";
import {
  countObservationChanged,
  isStalePositionError,
} from "./inventory-location-model.js";
import "./inventory-locations-workspace.css";

function countKey(locationId, positionId) {
  return `inventory-position-count:${locationId}:${positionId}`;
}
function readCountId(key) {
  try {
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
function saveCountId(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* browser storage is optional */
  }
}
function clearCountId(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* browser storage is optional */
  }
}

function statusLabel(status) {
  return ({
    open: "In progress",
    ready: "Ready to apply",
    applied: "Applied",
    needs_recount: "Needs recount",
    superseded: "Replaced",
  })[status] || "In progress";
}

function number(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(Number(value || 0));
}

function dateTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString();
}

export function PositionCountPanel({
  location,
  position,
  initialOpen = false,
  canApplyInventoryCount = false,
  onAddStock,
  onOpenStartingInventory,
  onChanged,
}) {
  const locationId = location?.id || location?.locationId || "";
  const positionId = position?.id || position?.positionId || "";
  const storageKey = countKey(locationId, positionId);
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [serialInputMode, setSerialInputMode] = useState("scanner");
  const [serialNumber, setSerialNumber] = useState("");
  const [serialFeedback, setSerialFeedback] = useState(null);
  const [expanded, setExpanded] = useState(initialOpen);
  const [foundOpen, setFoundOpen] = useState(false);
  const [foundQuery, setFoundQuery] = useState("");
  const [foundPart, setFoundPart] = useState(null);
  const [foundQuantity, setFoundQuantity] = useState("");
  const keys = useRef(new Map());
  const activeStorageKey = useRef(storageKey);
  const mounted = useRef(true);
  useEffect(() => {
    activeStorageKey.current = storageKey;
    return () => { activeStorageKey.current = ""; };
  }, [storageKey]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  function isActiveStorageKey(requestKey) {
    return mounted.current && activeStorageKey.current === requestKey;
  }
  function countMatchesPosition(next) {
    const countPositionId = next?.positionId || next?.position_id;
    const countLocationId = next?.locationId || next?.location_id;
    return (!countPositionId || countPositionId === positionId)
      && (!countLocationId || countLocationId === locationId);
  }
  const load = useCallback(
    async (countId = readCountId(storageKey)) => {
      if (!countId) return;
      const requestKey = storageKey;
      setBusy(true);
      setError("");
      try {
        const result = await api(
          `/api/office/inventory/position-counts/${encodeURIComponent(countId)}`,
        );
        if (!isActiveStorageKey(requestKey)) return;
        if (!countMatchesPosition(result.count)) {
          clearCountId(requestKey);
          setCount(null);
          setError("The saved physical count belongs to another storage location.");
          return;
        }
        setCount(result.count || null);
      } catch (next) {
        if (!isActiveStorageKey(requestKey)) return;
        clearCountId(requestKey);
        setCount(null);
        setError(next.message || "The saved count could not be reopened.");
      } finally {
        if (isActiveStorageKey(requestKey)) setBusy(false);
      }
    },
    [storageKey],
  );
  useEffect(() => {
    setCount(null);
    setError("");
    load();
  }, [load]);
  async function start() {
    const requestKey = storageKey;
    setBusy(true);
    setError("");
    const key = `position-count-start:${locationId}:${positionId}`;
    const idempotencyKey = keys.current.get(key) || crypto.randomUUID();
    keys.current.set(key, idempotencyKey);
    try {
      const result = await api(
        `/api/office/inventory/locations/${encodeURIComponent(locationId)}/position-counts`,
        {
          method: "POST",
          body: JSON.stringify({ positionId, idempotencyKey }),
        },
      );
      const next = result.count;
      if (!isActiveStorageKey(requestKey)) return;
      if (!countMatchesPosition(next)) {
        setError("The physical count response belongs to another storage location.");
        return;
      }
      setCount(next);
      setExpanded(true);
      saveCountId(requestKey, next.id);
      keys.current.delete(key);
    } catch (next) {
      if (!isActiveStorageKey(requestKey)) return;
      setError(
        next.message ||
          "Count could not be started. Retry keeps the same request.",
      );
    } finally {
      if (isActiveStorageKey(requestKey)) setBusy(false);
    }
  }
  async function addFoundPart(event) {
    event.preventDefault();
    if (!count || !foundPart || foundPart.trackingMode === "serialized") return;
    const observedQuantity = Number(foundQuantity);
    if (!Number.isFinite(observedQuantity) || observedQuantity <= 0) return;
    const requestKey = storageKey;
    const identity = `position-count-found:${count.id}:${count.version}:${foundPart.catalogPartId}:${observedQuantity}`;
    const idempotencyKey = keys.current.get(identity) || crypto.randomUUID();
    keys.current.set(identity, idempotencyKey);
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/api/office/inventory/position-counts/${encodeURIComponent(count.id)}/found-parts`,
        {
          method: "POST",
          body: JSON.stringify({
            catalogPartId: foundPart.catalogPartId,
            expectedPartVersion: foundPart.version,
            observedQuantity,
            expectedVersion: count.version,
            idempotencyKey,
          }),
        },
      );
      if (!isActiveStorageKey(requestKey)) return;
      if (!countMatchesPosition(result.count)) {
        setError("The physical count response belongs to another storage location.");
        return;
      }
      setCount(result.count);
      setFoundPart(null);
      setFoundQuery("");
      setFoundQuantity("");
      setFoundOpen(false);
      keys.current.delete(identity);
    } catch (next) {
      if (!isActiveStorageKey(requestKey)) return;
      const messages = {
        INVENTORY_POSITION_FOUND_PART_EXISTS: "This part is already in the count. Record its quantity on the existing line.",
        INVENTORY_POSITION_SERIAL_COUNT_REVIEW: "Serialized stock needs exact identity evidence. Use Add stock for a new arrival or Starting inventory for existing stock.",
        INVENTORY_CATALOG_PART_CHANGED: "This part changed. Select it again before continuing.",
      };
      setError(isStalePositionError(next) ? "This physical count changed elsewhere. Reload it before adding a found part." : messages[next.code] || next.message || "The found part could not be added.");
    } finally {
      if (isActiveStorageKey(requestKey)) setBusy(false);
    }
  }
  async function saveLine(line, observedQuantity) {
    const requestKey = storageKey;
    const identity = `position-count-line:${count.id}:${line.id}:${line.version}:${observedQuantity}`;
    const idempotencyKey = keys.current.get(identity) || crypto.randomUUID();
    keys.current.set(identity, idempotencyKey);
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/api/office/inventory/position-counts/${encodeURIComponent(count.id)}/lines/${encodeURIComponent(line.id)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            expectedVersion: line.version,
            observedQuantity: Number(observedQuantity),
            idempotencyKey,
          }),
        },
      );
      if (!isActiveStorageKey(requestKey)) return;
      if (!countMatchesPosition(result.count)) {
        setError("The physical count response belongs to another storage location.");
        return;
      }
      setCount(result.count);
      keys.current.delete(identity);
      return true;
    } catch (next) {
      if (!isActiveStorageKey(requestKey)) return;
      setError(
        isStalePositionError(next)
          ? "This physical count changed elsewhere. Reload it before editing another line."
          : next.message || "Observed quantity could not be saved.",
      );
      return false;
    } finally {
      if (isActiveStorageKey(requestKey)) setBusy(false);
    }
  }
  async function observeIdentity(event) {
    event.preventDefault();
    const normalized = serialNumber.trim();
    if (!normalized || !count) return;
    const requestKey = storageKey;
    const identity = `position-count-identity:${count.id}:${count.version}:${serialInputMode}:${normalized}`;
    const idempotencyKey = keys.current.get(identity) || crypto.randomUUID();
    keys.current.set(identity, idempotencyKey);
    setBusy(true);
    setError("");
    setSerialFeedback(null);
    try {
      const result = await api(
        `/api/office/inventory/position-counts/${encodeURIComponent(count.id)}/identities`,
        {
          method: "PUT",
          body: JSON.stringify({
            serialNumber: normalized,
            inputMode: serialInputMode,
            expectedVersion: count.version,
            idempotencyKey,
          }),
        },
      );
      if (!isActiveStorageKey(requestKey)) return;
      if (!countMatchesPosition(result.count)) {
        setError("The physical count response belongs to another storage location.");
        return;
      }
      setCount(result.count);
      setSerialNumber("");
      setSerialFeedback({
        kind: result.alreadyObserved ? "duplicate" : "confirmed",
        message: result.alreadyObserved
          ? `${normalized} was already confirmed. No duplicate was added.`
          : `${normalized} confirmed.`,
      });
      keys.current.delete(identity);
      window.requestAnimationFrame(() => document.getElementById(`position-count-serial-${count.id}`)?.focus());
    } catch (next) {
      if (!isActiveStorageKey(requestKey)) return;
      const messages = {
        INVENTORY_POSITION_SERIAL_NOT_FOUND: `${normalized} was not found. Check the label or use Add stock for a new arrival.`,
        INVENTORY_POSITION_SERIAL_WRONG_POSITION: `${normalized} belongs to another location. Move it here before counting it.`,
        INVENTORY_POSITION_STALE: "This physical count changed elsewhere. Reload it before scanning another identity.",
        INVENTORY_POSITION_REPLAY_CONFLICT: "That scan was reused with different details. Scan the identity again.",
      };
      setSerialFeedback({ kind: "error", message: messages[next.code] || next.message || "The identity could not be confirmed." });
    } finally {
      if (isActiveStorageKey(requestKey)) setBusy(false);
    }
  }
  async function apply() {
    const requestKey = storageKey;
    const identity = `position-count-apply:${count.id}:${count.version}:${reason.trim()}`;
    const idempotencyKey = keys.current.get(identity) || crypto.randomUUID();
    keys.current.set(identity, idempotencyKey);
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/api/office/inventory/position-counts/${encodeURIComponent(count.id)}/apply`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedVersion: count.version,
            idempotencyKey,
            reason: reason.trim(),
          }),
        },
      );
      if (!isActiveStorageKey(requestKey)) return;
      if (!countMatchesPosition(result.count)) {
        setError("The physical count response belongs to another storage location.");
        return;
      }
      setCount(result.count);
      keys.current.delete(identity);
      onChanged?.();
    } catch (next) {
      if (!isActiveStorageKey(requestKey)) return;
      setError(
        isStalePositionError(next)
          ? "This physical count changed elsewhere. Reload before applying it."
          : next.message || "Physical count could not be applied.",
      );
    } finally {
      if (isActiveStorageKey(requestKey)) setBusy(false);
    }
  }
  if (!positionId || position?.canStore !== true) return null;
  if (!expanded) return <section className="position-count-launcher" aria-labelledby={`position-count-${positionId}`}>
    <div><h3 id={`position-count-${positionId}`}>Physical count</h3><p>{count ? `${statusLabel(count.status)} · Started by ${count.createdBy?.name || "Inventory user"}` : "Verify and reconcile stock in this exact location."}</p></div>
    <Button type="button" onClick={() => count ? setExpanded(true) : start()} disabled={busy}>{count ? "Resume count" : "Start count"}</Button>
  </section>;
  return (
    <section
      className="position-count-panel"
      aria-labelledby={`position-count-${positionId}`}
    >
      <header>
        <div>
          <h3 id={`position-count-${positionId}`}>Physical count</h3>
          <p>
            Count {position.path || position.code || position.name}.
            Observations save one line at a time.
          </p>
        </div>
        <div className="position-count-header-actions"><Button type="button" onClick={() => setExpanded(false)} disabled={busy}>Back to stock</Button>{!count ? <Button type="button" variant="primary" onClick={start} disabled={busy}>Start count</Button> : <Button type="button" onClick={() => load(count.id)} disabled={busy}>Refresh</Button>}</div>
      </header>
      {error ? (
        <p className="ops-error" role="alert">
          {error}
        </p>
      ) : null}
      {count ? (
        <>
          <div className="position-count-summary" role="status">
            <span className={`position-count-status is-${count.status || "open"}`}>{statusLabel(count.status)}</span>
            <span>Started by {count.createdBy?.name || "Inventory user"}{dateTime(count.createdAt) ? ` · ${dateTime(count.createdAt)}` : ""}</span>
          </div>
          {(count.lines || []).length ? <div className="part-position-list position-count-lines">
            {(count.lines || []).map((line) => (
              <CountLine
                key={line.id}
                line={line}
                busy={busy || count.status !== "open"}
                onSave={saveLine}
                nextLineId={(count.lines[count.lines.indexOf(line) + 1] || {}).id}
              />
            ))}
          </div> : null}
          {(count.serialGroups || []).length ? (
            <section className="position-count-serials" aria-label="Serialized identities">
              <header>
                <div><h4>Serialized parts</h4><p>Scan or enter every identity physically in this location.</p></div>
              </header>
              {(count.serialGroups || []).map((group) => (
                <article className="position-count-serial-group" key={group.partId}>
                  <div className="position-count-serial-progress">
                    <div><strong>{group.partNumber || "Serialized part"}</strong><small>{group.description || ""}</small></div>
                    <span>{group.observedCount} of {group.expectedCount} confirmed</span>
                  </div>
                  <div className="position-count-serial-units" aria-label={`${group.partNumber || "Serialized part"} identities`}>
                    {(group.units || []).map((unit) => <span className={unit.observed ? "is-confirmed" : ""} key={unit.unitId}>{unit.serialNumber}<small>{unit.observed ? "Confirmed" : "Expected"}</small></span>)}
                  </div>
                </article>
              ))}
              {count.status === "open" ? <form className="position-count-serial-entry" onSubmit={observeIdentity}>
                <div className="position-count-mode" role="group" aria-label="Identity entry method">
                  <button type="button" aria-pressed={serialInputMode === "scanner"} onClick={() => setSerialInputMode("scanner")}>Scanner</button>
                  <button type="button" aria-pressed={serialInputMode === "manual"} onClick={() => setSerialInputMode("manual")}>Manual</button>
                </div>
                <label>
                  {serialInputMode === "scanner" ? "Scan serial or barcode" : "Serial number"}
                  <input id={`position-count-serial-${count.id}`} autoComplete="off" value={serialNumber} disabled={busy} onChange={(event) => setSerialNumber(event.target.value)} />
                </label>
                <Button type="submit" disabled={busy || !serialNumber.trim()}>{serialInputMode === "scanner" ? "Confirm scan" : "Confirm serial"}</Button>
              </form> : null}
              {serialFeedback ? <p className={`position-count-feedback is-${serialFeedback.kind}`} role={serialFeedback.kind === "error" ? "alert" : "status"}>{serialFeedback.message}</p> : null}
            </section>
          ) : null}
          {count.status === "open" ? <section className="position-count-found" aria-labelledby={`position-count-found-${count.id}`}>
            <div className="position-count-found-heading"><div><h4 id={`position-count-found-${count.id}`}>Part missing from this count?</h4><p>Record company stock physically found here. Expected quantity starts at zero.</p></div><Button type="button" onClick={() => setFoundOpen((value) => !value)} disabled={busy}>{foundOpen ? "Cancel" : "Add found part"}</Button></div>
            {foundOpen ? <form onSubmit={addFoundPart}>
              <PartCatalogCombobox locationId={locationId} purpose="master_match" catalogEndpoint="/api/office/inventory/catalog" value={foundQuery} onChange={(value) => { setFoundQuery(value); setFoundPart(null); }} onSelect={(part) => { setFoundPart({ ...part, catalogPartId: part.catalogPartId || part.id }); setFoundQuery(part.partNumber || ""); setFoundQuantity(""); }} disabled={busy} inputAriaLabel="Choose a found master catalog part" popupAriaLabel="Matching found master catalog parts" />
              {foundPart ? foundPart.trackingMode === "serialized" ? <div className="position-count-found-serialized" role="note"><p><strong>Exact identities required.</strong> Register a new arrival through Add stock, or use Starting inventory for stock that was already here.</p><div><Button type="button" onClick={() => onAddStock?.(foundPart)}>Add stock</Button><Button type="button" onClick={() => onOpenStartingInventory?.()}>Starting inventory</Button></div></div> : <label>Observed quantity <span className="position-count-found-quantity"><input type="number" min="0" step={foundPart.trackingMode === "quantity" ? "1" : String(1 / (10 ** Number(foundPart.decimalScale || 3)))} value={foundQuantity} onChange={(event) => setFoundQuantity(event.target.value)} disabled={busy} required /><span>{foundPart.canonicalUomCode || foundPart.uomCode}</span></span></label> : null}
              {foundPart?.trackingMode !== "serialized" ? <Button type="submit" variant="primary" disabled={busy || !foundPart || !(Number(foundQuantity) > 0)}>Add to count</Button> : null}
            </form> : null}
          </section> : null}
          {count.status === "open" &&
          count.canApply &&
          canApplyInventoryCount ? (
            <form
              className="part-position-move"
              onSubmit={(event) => {
                event.preventDefault();
                apply();
              }}
            >
              <label>
                Apply reason
                <input
                  required
                  minLength="2"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  disabled={busy}
                />
              </label>
              <Button
                type="submit"
                variant="primary"
                disabled={busy || !reason.trim()}
              >
                Apply physical count
              </Button>
            </form>
          ) : count.status === "needs_recount" ? (
            <div className="part-position-move" role="alert">
              <p>
                This physical count needs a recount because stock moved after it started.
                Its lines are read-only.
              </p>
              <Button
                type="button"
                variant="primary"
                onClick={start}
                disabled={busy}
              >
                Count stock again
              </Button>
            </div>
          ) : ["applied", "superseded"].includes(count.status) ? (
            <div className="part-position-move">
              <p>
                {count.status === "applied"
                  ? `Applied${count.appliedBy?.name ? ` by ${count.appliedBy.name}` : ""}${dateTime(count.appliedAt) ? ` · ${dateTime(count.appliedAt)}` : ""}${count.applyReason ? ` · ${count.applyReason}` : ""}.`
                  : "This physical count was replaced by a newer recount."}
              </p>
              <Button type="button" onClick={start} disabled={busy}>
                Count stock again
              </Button>
            </div>
          ) : (
            <p>
              Office can record observations. An authorized administrator must
              apply this physical count.
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
function CountLine({ line, busy, onSave, nextLineId }) {
  const [value, setValue] = useState(line.observedQuantity ?? "");
  const saving = useRef(false);
  useEffect(() => {
    setValue(line.observedQuantity ?? "");
  }, [line.id, line.observedQuantity, line.version]);
  return (
    <article className="position-count-line">
      <div>
        <strong>{line.partNumber || line.partId}</strong>
        <small>{line.description || ""}</small>
      </div>
      <span><small>Expected</small><strong>{number(line.expectedQuantity)} {line.uomCode}</strong></span>
      <label><small>Counted</small>
        <input
          id={`position-count-line-${line.id}`}
          aria-label={`Counted quantity for ${line.partNumber || line.partId}`}
          type="number"
          min="0"
          step="any"
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => {
            if (saving.current) return;
            if (countObservationChanged(line.observedQuantity, value))
              onSave(line, value);
          }}
          onKeyDown={async (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            saving.current = true;
            const saved = countObservationChanged(line.observedQuantity, value) ? await onSave(line, value) : true;
            saving.current = false;
            if (saved && nextLineId) window.requestAnimationFrame(() => document.getElementById(`position-count-line-${nextLineId}`)?.focus());
          }}
        />
      </label>
      <span><small>Difference</small><strong className={Number(line.difference ?? ((line.observedQuantity ?? 0) - line.expectedQuantity)) === 0 ? "is-even" : "is-different"}>{line.observedQuantity === null || line.observedQuantity === undefined ? "—" : number(line.difference ?? (line.observedQuantity - line.expectedQuantity))}</strong></span>
      <span className={`position-count-line-state is-${line.status || "open"}`}>{line.status === "observed" || line.status === "applied" ? "Saved" : line.status === "needs_recount" ? "Recount" : "Not counted"}</span>
    </article>
  );
}
