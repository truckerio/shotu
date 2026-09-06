import { useEffect, useRef, useState } from "react";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";
import {
  workorderDetailSearch,
} from "../../app/routes/route-state.js";
import {
  assetReusePath,
  clearReuseRecovery,
  lifecycleIdempotencyKey,
  restoreReuseRecovery,
  reuseOperationPath,
  reuseScope,
  saveReuseRecovery,
} from "./unit-parts-lifecycle-model.js";
import { PartCatalogCombobox } from "../../components/workorders/part-requests/PartCatalogCombobox.jsx";

function partLabel(part) {
  return (
    [part.partNumber, part.description, part.serialNumber]
      .filter(Boolean)
      .join(" · ") || "Tracked part"
  );
}

function workorderLabel(workorder) {
  return workorder.workorderSerial || workorder.serial || workorder.id;
}

function WorkorderLink({ workorder }) {
  const id = workorder?.workorderId || workorder?.id || workorder;
  const label = typeof workorder === "object" ? workorderLabel(workorder) : id;
  return id ? (
    <a href={workorderDetailSearch(id)} aria-label={`Open workorder ${label}`}>
      {label}
    </a>
  ) : (
    "not recorded"
  );
}

function recoveryStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function UnitPartsLifecycle({
  unit,
  actorId = "",
  initialUsageId = "",
  onChanged,
  onBusyChange,
  onModeChange,
}) {
  const scope = reuseScope(unit);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activePart, setActivePart] = useState(null);
  const [draft, setDraft] = useState({
    reason: "",
    intendedRoute: "inspect_for_reuse",
    note: "",
    ownership: "",
    ownershipEvidence: "",
  });
  const [pendingRequest, setPendingRequest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [needsReconcile, setNeedsReconcile] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [legacyDraft, setLegacyDraft] = useState({
    catalogPartId: "",
    serialNumber: "",
    reason: "",
    intendedRoute: "inspect_for_reuse",
    ownership: "unknown",
    ownershipEvidence: "",
    note: "",
  });
  const [legacyPartQuery, setLegacyPartQuery] = useState("");
  const keys = useRef(new Map());
  const openedInitialRef = useRef("");
  const loadControllerRef = useRef(null);
  const loadGenerationRef = useRef(0);
  const restoredRecoveryKeysRef = useRef(new Set());
  const removalFormRef = useRef(null);

  const hasScope = Boolean(scope.companyId && scope.locationId);
  const recoveryScope = { actorId, ...scope, assetId: unit?.id || "" };
  async function load() {
    if (!hasScope || !unit?.id) return;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    const generation = ++loadGenerationRef.current;
    loadControllerRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const next = await api(assetReusePath(unit.id, scope), {
        signal: controller.signal,
      });
      if (generation === loadGenerationRef.current) setData(next);
    } catch (failure) {
      if (
        generation === loadGenerationRef.current &&
        !controller.signal.aborted
      ) {
        setData(null);
        setError(failure.message || "Could not load tracked parts.");
      }
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    setActivePart(null);
    setPendingRequest(null);
    setNeedsReconcile(false);
    setData(null);
    setError("");
    setDraft({
      reason: "",
      intendedRoute: "inspect_for_reuse",
      note: "",
      ownership: "unknown",
      ownershipEvidence: "",
    });
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
    const command = restoreReuseRecovery(
      recoveryStorage(),
      recoveryScope,
      restoredRecoveryKeysRef.current,
    );
    if (command) {
      setPendingRequest(command);
      setNeedsReconcile(true);
      setError(
        "A previous custody request needs its outcome checked before any retry.",
      );
    }
  }, [actorId, unit?.id, scope.companyId, scope.locationId]);

  useEffect(() => {
    if (!actorId || !hasScope || !unit?.id) return undefined;
    function warnBeforeUnload(event) {
      if (!pendingRequest || (!needsReconcile && !busy)) return;
      event.preventDefault();
      event.returnValue = "A custody request outcome still needs checking.";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [
    actorId,
    unit?.id,
    scope.companyId,
    scope.locationId,
    pendingRequest,
    needsReconcile,
    busy,
  ]);

  useEffect(() => {
    const initial = `${unit?.id}:${initialUsageId}`;
    if (!data || !initialUsageId || openedInitialRef.current === initial)
      return;
    const part = (data.installedParts || []).find(
      (item) => item.usageId === initialUsageId,
    );
    if (!part) return;
    openedInitialRef.current = initial;
    openRemoval(part);
  }, [data, initialUsageId, unit?.id]);

  useEffect(() => {
    onBusyChange?.(busy || Boolean(pendingRequest) || needsReconcile);
  }, [busy, pendingRequest, needsReconcile, onBusyChange]);

  useEffect(() => {
    onModeChange?.(activePart ? "remove" : "");
    return () => onModeChange?.("");
  }, [activePart, onModeChange]);

  useEffect(() => {
    if (!activePart) return undefined;
    const frame = window.requestAnimationFrame(() => {
      removalFormRef.current?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePart?.usageId]);

  function openRemoval(item) {
    if (busy || pendingRequest) return;
    setPendingRequest(null);
    setNeedsReconcile(false);
    setError("");
    setActivePart(item);
    setDraft({
      reason: "",
      intendedRoute: "inspect_for_reuse",
      note: "",
      ownership: "unknown",
      ownershipEvidence: "",
    });
  }
  function closeForm() {
    setActivePart(null);
    setPendingRequest(null);
  }

  async function submit(request = pendingRequest) {
    if (!request || busy || needsReconcile) return;
    if (!saveReuseRecovery(recoveryStorage(), recoveryScope, request)) {
      setError("This action cannot be saved until session storage is available.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(request.path, {
        method: "POST",
        body: JSON.stringify(request.body),
      });
      clearReuseRecovery(recoveryStorage(), recoveryScope);
      setPendingRequest(null);
      if (request.path === "/api/inventory-reuse/legacy-track") {
        setLegacyOpen(false);
        setLegacyPartQuery("");
        setLegacyDraft({
          catalogPartId: "",
          serialNumber: "",
          reason: "",
          intendedRoute: "inspect_for_reuse",
          ownership: "unknown",
          ownershipEvidence: "",
          note: "",
        });
      }
      closeForm();
      await load();
      await onChanged?.();
    } catch (failure) {
      const uncertain = !failure.status || failure.status >= 500;
      if (uncertain) {
        setPendingRequest(request);
        setNeedsReconcile(true);
        setError(
          `${failure.message || "The update result is unknown."} Check the saved request before retrying.`,
        );
      } else {
        clearReuseRecovery(recoveryStorage(), recoveryScope);
        setPendingRequest(null);
        setNeedsReconcile(false);
        setError(
          `${failure.message || "The update could not be saved."} Correct the entry and try again.`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function reconcile() {
    if (!pendingRequest || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(reuseOperationPath(pendingRequest.body.idempotencyKey, scope));
      clearReuseRecovery(recoveryStorage(), recoveryScope);
      setPendingRequest(null);
      setNeedsReconcile(false);
      closeForm();
      await load();
      await onChanged?.();
    } catch (failure) {
      if (failure.code === "INVENTORY_REUSE_OPERATION_NOT_FOUND") {
        clearReuseRecovery(recoveryStorage(), recoveryScope);
        setNeedsReconcile(false);
        setError(
          "No committed operation was found. You may retry the saved request.",
        );
      } else
        setError(
          `${failure.message || "Could not check the request."} Do not retry until its status is known.`,
        );
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    const item = activePart;
    if (!draft.reason.trim()) return;
    const identity = `remove:${item.usageId}:unit-detail:${draft.reason}:${draft.intendedRoute}:${item.ownershipRequired ? draft.ownership : item.inferredOwnership}:${draft.ownershipEvidence}:${draft.note}`;
    const request = {
      path: "/api/inventory-reuse/remove",
      body: {
        ...scope,
        usageId: item.usageId,
        reason: draft.reason.trim(),
        intendedRoute: draft.intendedRoute,
        ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
        ...(item.ownershipRequired && draft.ownership
          ? {
              ownership: draft.ownership,
              ownershipEvidence: draft.ownershipEvidence.trim(),
            }
          : {}),
        expectedVersion: item.custodyVersion ?? item.version,
        idempotencyKey: lifecycleIdempotencyKey(keys.current, identity),
      },
    };
    setPendingRequest(request);
    submit(request);
  }
  function trackLegacy() {
    if (
      !legacyDraft.catalogPartId ||
      !legacyDraft.reason ||
      busy ||
      pendingRequest
    )
      return;
    const identity = `legacy:${unit.id}:${legacyDraft.catalogPartId}:${legacyDraft.serialNumber}:${legacyDraft.reason}:${legacyDraft.intendedRoute}`;
    const request = {
      path: "/api/inventory-reuse/legacy-track",
      body: {
        ...scope,
        assetId: unit.id,
        catalogPartId: legacyDraft.catalogPartId,
        ...(legacyDraft.serialNumber.trim()
          ? { serialNumber: legacyDraft.serialNumber.trim() }
          : {}),
        reason: legacyDraft.reason,
        intendedRoute: legacyDraft.intendedRoute,
        ownership: legacyDraft.ownership,
        ownershipEvidence: legacyDraft.ownershipEvidence.trim(),
        note: legacyDraft.note.trim(),
        idempotencyKey: lifecycleIdempotencyKey(keys.current, identity),
      },
    };
    setPendingRequest(request);
    submit(request);
  }

  if (!hasScope)
    return (
      <p className="unit-parts-notice" role="status">
        Tracked parts are unavailable until this unit has a company and
        receiving location.
      </p>
    );
  if (!data && error)
    return (
      <div className="unit-parts-notice" role="alert">
        <p>{error}</p>
        <Button type="button" onClick={load}>
          Try again
        </Button>
      </div>
    );
  if (!data)
    return (
      <p className="unit-parts-notice" role="status">
        Loading tracked parts…
      </p>
    );
  const installedParts = data?.installedParts || [];
  const pendingParts = installedParts.filter(
    (part) => part.status === "installed_pending_approval",
  );
  const approvedParts = installedParts.filter(
    (part) => part.status !== "installed_pending_approval",
  );
  return (
    <div
      className={`unit-parts-lifecycle${
        activePart ? " unit-parts-lifecycle--focused" : ""
      }`}
    >
      {error ? (
        <div className="unit-parts-error" role="alert">
          <span>{error}</span>
          {pendingRequest && needsReconcile ? (
            <Button type="button" disabled={busy} onClick={reconcile}>
              Check saved request
            </Button>
          ) : null}
          {pendingRequest && !needsReconcile ? (
            <Button type="button" disabled={busy} onClick={() => submit()}>
              Retry saved request
            </Button>
          ) : null}
        </div>
      ) : null}
      <section aria-labelledby="tracked-installed-parts">
        <div className="unit-parts-section-heading">
          <div>
            <h4 id="tracked-installed-parts">Tracked installed parts</h4>
          </div>
          {loading ? <span role="status">Refreshing…</span> : null}
        </div>
        {!approvedParts.length ? (
          <p className="unit-parts-notice">
            No approved installed parts on this unit.
          </p>
        ) : (
          <ul className="unit-parts-list">
            {approvedParts.map((part) => (
              <li key={part.usageId}>
                <div>
                  <strong>{partLabel(part)}</strong>
                  <span>
                    Installed on <WorkorderLink workorder={part} />
                  </span>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  disabled={
                    busy ||
                    Boolean(pendingRequest) ||
                    !data?.capabilities?.remove
                  }
                  onClick={() => openRemoval(part)}
                >
                  Remove part
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {pendingParts.length ? (
        <section aria-labelledby="pending-installations">
          <div className="unit-parts-section-heading">
            <div>
              <h4 id="pending-installations">Pending installation</h4>
            </div>
          </div>
          <ul className="unit-parts-list">
            {pendingParts.map((part) => (
              <li key={part.usageId}>
                <div>
                  <strong>{partLabel(part)}</strong>
                  <span>
                    Original workorder <WorkorderLink workorder={part} />
                  </span>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  disabled={
                    busy ||
                    Boolean(pendingRequest) ||
                    !data?.capabilities?.remove
                  }
                  onClick={() => openRemoval(part)}
                >
                  Remove part
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <details className="unit-parts-optional unit-parts-legacy">
        <summary>Part not listed?</summary>
        <section
          className="unit-parts-form"
          aria-label="Track untracked removed part"
        >
        <h4>Track an untracked removed part</h4>
        <p>
          Earlier physical history unavailable. This records today’s removal and
          creates a permanent QR identity; it does not invent a serial, invoice,
          cost, or installation history.
        </p>
        {!legacyOpen ? (
          <Button
            type="button"
            disabled={
              busy || Boolean(pendingRequest) || !data?.capabilities?.remove
            }
            onClick={() => setLegacyOpen(true)}
          >
            Track removed part
          </Button>
        ) : (
          <>
            <PartCatalogCombobox
              locationId={scope.locationId}
              purpose="master_match"
              value={legacyPartQuery}
              onChange={(value) => {
                setLegacyPartQuery(value);
                setLegacyDraft((current) => ({
                  ...current,
                  catalogPartId: "",
                }));
              }}
              onSelect={(part) => {
                setLegacyPartQuery(part.partNumber);
                setLegacyDraft((current) => ({
                  ...current,
                  catalogPartId: part.id,
                }));
              }}
              disabled={busy || Boolean(pendingRequest)}
              label="Part"
              inputAriaLabel="Search and select the removed catalog part"
              placeholder="Search by part number or description"
              catalogEndpoint="/api/office/inventory/catalog"
              resultLimit={12}
              popupAriaLabel="Matching catalog parts"
            />
            {!legacyDraft.catalogPartId && legacyPartQuery.trim() ? (
              <p className="unit-parts-notice">
                Choose a catalog part from the results; typed text is not saved
                as an ID.
              </p>
            ) : null}
            <label>
              Actual serial <span>(optional)</span>
              <input
                value={legacyDraft.serialNumber}
                onChange={(event) =>
                  setLegacyDraft((current) => ({
                    ...current,
                    serialNumber: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Reason
              <input
                value={legacyDraft.reason}
                onChange={(event) =>
                  setLegacyDraft((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Route
              <Dropdown
                aria-label="Legacy next action"
                value={legacyDraft.intendedRoute}
                onChange={(event) =>
                  setLegacyDraft((current) => ({
                    ...current,
                    intendedRoute: event.target.value,
                  }))
                }
              >
                <option value="inspect_for_reuse">Inspect for reuse</option>
                <option value="repair">Repair/refurbish</option>
                <option value="core_return">Core return</option>
                <option value="scrap">Scrap</option>
                <option value="not_sure">Not sure</option>
              </Dropdown>
            </label>
            <label>
              Ownership
              <Dropdown
                aria-label="Legacy ownership"
                value={legacyDraft.ownership}
                onChange={(event) =>
                  setLegacyDraft((current) => ({
                    ...current,
                    ownership: event.target.value,
                  }))
                }
              >
                <option value="unknown">Unknown</option>
                <option value="company">Company</option>
                <option value="customer">Customer</option>
              </Dropdown>
            </label>
            {legacyDraft.ownership === "company" ? (
              <label>
                Ownership evidence
                <input
                  value={legacyDraft.ownershipEvidence}
                  onChange={(event) =>
                    setLegacyDraft((current) => ({
                      ...current,
                      ownershipEvidence: event.target.value,
                    }))
                  }
                />
              </label>
            ) : null}
            <div>
              <Button
                type="button"
                onClick={trackLegacy}
                disabled={
                  busy ||
                  Boolean(pendingRequest) ||
                  !legacyDraft.catalogPartId ||
                  !legacyDraft.reason ||
                  (legacyDraft.ownership === "company" &&
                    !legacyDraft.ownershipEvidence.trim())
                }
              >
                Create tracking and handoff
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setLegacyOpen(false);
                  setLegacyPartQuery("");
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </>
        )}
        </section>
      </details>
      {activePart ? (
        <section
          className="unit-parts-form unit-parts-removal-form"
          aria-label="Remove tracked part"
          ref={removalFormRef}
        >
          <div className="unit-parts-removal-heading">
            <div>
              <h4>Remove part</h4>
              <strong>{partLabel(activePart)}</strong>
              <span>
                Installed on <WorkorderLink workorder={activePart} />
              </span>
            </div>
            <Button
              type="button"
              disabled={busy || Boolean(pendingRequest)}
              onClick={closeForm}
            >
              Back
            </Button>
          </div>
          <label>
            Reason
            <Dropdown
              aria-label="Removal reason"
              disabled={busy || Boolean(pendingRequest)}
              value={draft.reason}
              onChange={(event) =>
                setDraft((value) => ({ ...value, reason: event.target.value }))
              }
            >
              <option value="">Choose reason</option>
              <option value="failed">Failed</option>
              <option value="worn">Worn</option>
              <option value="preventive_replacement">
                Preventive replacement
              </option>
              <option value="wrong_part">Wrong part</option>
              <option value="other">Other</option>
            </Dropdown>
          </label>
          <label>
            Next step
            <Dropdown
              aria-label="Intended route"
              disabled={busy || Boolean(pendingRequest)}
              value={draft.intendedRoute}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  intendedRoute: event.target.value,
                }))
              }
            >
              <option value="inspect_for_reuse">Inspect for reuse</option>
              <option value="repair">Repair/refurbish</option>
              <option value="core_return">Core return</option>
              <option value="scrap">Scrap</option>
              <option value="not_sure">Not sure</option>
            </Dropdown>
          </label>
          {activePart.ownershipRequired ? (
            <>
              <label>
                Owner
                <Dropdown
                  aria-label="Part ownership"
                  disabled={busy || Boolean(pendingRequest)}
                  value={draft.ownership}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      ownership: event.target.value,
                    }))
                  }
                >
                  <option value="company">Company</option>
                  <option value="customer">Customer</option>
                  <option value="unknown">Not sure</option>
                </Dropdown>
              </label>
              {draft.ownership === "company" ? <label>
                Ownership proof
                <input
                  disabled={busy || Boolean(pendingRequest)}
                  value={draft.ownershipEvidence}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      ownershipEvidence: event.target.value,
                    }))
                  }
                />
              </label> : null}
            </>
          ) : null}
          <details className="unit-parts-optional">
            <summary>Add note</summary>
            <label>
              Note
              <textarea
                disabled={busy || Boolean(pendingRequest)}
                rows="2"
                value={draft.note}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, note: event.target.value }))
                }
              />
            </label>
          </details>
          <div>
            <Button
              type="button"
              variant="primary"
              onClick={remove}
              disabled={
                busy ||
                Boolean(pendingRequest) ||
                !draft.reason ||
                (activePart.ownershipRequired && !draft.ownership) ||
                (activePart.ownershipRequired &&
                  draft.ownership === "company" &&
                  !draft.ownershipEvidence.trim())
              }
            >
              {busy ? "Removing…" : "Remove part"}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
