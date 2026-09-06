import { useEffect, useRef, useState } from "react";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";
import {
  workorderDetailSearch,
} from "../../app/routes/route-state.js";
import {
  assetReusePath,
  canReleaseCase,
  caseStage,
  clearReuseRecovery,
  eligibleRemovalWorkorders,
  lifecycleIdempotencyKey,
  restoreReuseRecovery,
  reuseOperationPath,
  reuseScope,
  saveReuseRecovery,
} from "./unit-parts-lifecycle-model.js";
import { ReuseSetup } from "./ReuseSetup.jsx";
import { PartCatalogCombobox } from "../../components/workorders/part-requests/PartCatalogCombobox.jsx";
import { InventoryCodeScanner } from "../inventory/InventoryCodeScanner.jsx";

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
  initialWorkorderId = "",
  onChanged,
  onBusyChange,
  onModeChange,
}) {
  const scope = reuseScope(unit);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(null);
  const [draft, setDraft] = useState({
    reason: "",
    intendedRoute: "inspect_for_reuse",
    note: "",
    ownership: "",
    ownershipEvidence: "",
    evidence: "",
    inspectionEvidence: "",
    reviewReason: "",
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
  const [receivedExactUnitId, setReceivedExactUnitId] = useState("");
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
    setActive(null);
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
      evidence: "",
      inspectionEvidence: "",
      reviewReason: "",
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
    const initial = `${unit?.id}:${initialUsageId}:${initialWorkorderId}`;
    if (!data || !initialUsageId || openedInitialRef.current === initial)
      return;
    const part = (data.installedParts || []).find(
      (item) => item.usageId === initialUsageId,
    );
    if (!part) return;
    openedInitialRef.current = initial;
    openForm("remove", {
      ...part,
      removalWorkorderId:
        part.status === "installed_pending_approval" ? initialWorkorderId : "",
    });
  }, [data, initialUsageId, initialWorkorderId, unit?.id]);

  useEffect(() => {
    onBusyChange?.(busy || Boolean(pendingRequest) || needsReconcile);
  }, [busy, pendingRequest, needsReconcile, onBusyChange]);

  useEffect(() => {
    onModeChange?.(active?.kind === "remove" ? "remove" : "");
    return () => onModeChange?.("");
  }, [active?.kind, onModeChange]);

  useEffect(() => {
    if (active?.kind !== "remove") return undefined;
    const frame = window.requestAnimationFrame(() => {
      removalFormRef.current?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active?.kind, active?.item?.usageId]);

  function openForm(kind, item) {
    if (busy || pendingRequest) return;
    setPendingRequest(null);
    setNeedsReconcile(false);
    setError("");
    setReceivedExactUnitId("");
    setActive({ kind, item });
    setDraft({
      reason: "",
      intendedRoute: "inspect_for_reuse",
      note: "",
      ownership: "unknown",
      ownershipEvidence: "",
      evidence: "",
      inspectionEvidence: "",
      reviewReason: "",
    });
  }
  function closeForm() {
    setActive(null);
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
    const { item } = active;
    if (!draft.reason.trim()) return;
    const eligibleWorkorders = eligibleRemovalWorkorders(
      item,
      data?.removalWorkorders || [],
    );
    const removalWorkorderId =
      item.removalWorkorderId ||
      (eligibleWorkorders.length === 1 ? eligibleWorkorders[0].id : "");
    const identity = `remove:${item.usageId}:${removalWorkorderId || "derived"}:${draft.reason}:${draft.intendedRoute}:${draft.ownership}:${draft.ownershipEvidence}:${draft.note}`;
    const request = {
      path: "/api/inventory-reuse/remove",
      body: {
        ...scope,
        usageId: item.usageId,
        ...(removalWorkorderId
          ? { removalWorkorderId }
          : {}),
        reason: draft.reason.trim(),
        intendedRoute: draft.intendedRoute,
        ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
        ...(draft.ownership
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
  function receive() {
    if (!draft.evidence.trim() || !receivedExactUnitId) return;
    const identity = `receive:${active.item.id}:${draft.evidence}`;
    const request = {
      path: `/api/inventory-reuse/${encodeURIComponent(active.item.id)}/receive`,
      body: {
        ...scope,
        evidence: draft.evidence.trim(),
        exactUnitId: receivedExactUnitId,
        expectedVersion: active.item.caseVersion ?? active.item.version,
        idempotencyKey: lifecycleIdempotencyKey(keys.current, identity),
      },
    };
    setPendingRequest(request);
    submit(request);
  }
  async function resolveReceivedExact(code) {
    const result = await api(
      `/api/inventory-reuse/scan?${new URLSearchParams({ ...scope, code })}`,
    );
    const scanned = result.unit || result;
    const expectedId =
      active?.item?.unitId ||
      active?.item?.serializedUnitId ||
      active?.item?.inventoryUnitId;
    if (!scanned?.id || (expectedId && scanned.id !== expectedId))
      throw new Error("That QR or serial does not match this returned part.");
    setReceivedExactUnitId(scanned.id);
  }
  function review(decision) {
    if (!draft.inspectionEvidence.trim() || !draft.reviewReason.trim()) return;
    const identity = `review:${active.item.id}:${decision}:${draft.inspectionEvidence}:${draft.reviewReason}`;
    const request = {
      path: `/api/inventory-reuse/${encodeURIComponent(active.item.id)}/review`,
      body: {
        ...scope,
        decision,
        inspectionEvidence: draft.inspectionEvidence.trim(),
        reason: draft.reviewReason.trim(),
        expectedVersion: active.item.caseVersion ?? active.item.version,
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
  const cases = data?.cases || [];
  const removalWorkorders = data?.removalWorkorders || [];
  const eligibleRemovalWorkordersForActive =
    active?.kind === "remove"
      ? eligibleRemovalWorkorders(active.item, removalWorkorders)
      : [];
  return (
    <div
      className={`unit-parts-lifecycle${
        active?.kind === "remove" ? " unit-parts-lifecycle--focused" : ""
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
                  disabled={
                    busy ||
                    Boolean(pendingRequest) ||
                    !data?.capabilities?.remove
                  }
                  onClick={() => openForm("remove", part)}
                >
                  Remove
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
                  disabled={
                    busy ||
                    Boolean(pendingRequest) ||
                    !data?.capabilities?.remove
                  }
                  onClick={() => openForm("remove", part)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="returned-parts">
        <div className="unit-parts-section-heading">
          <div>
            <h4 id="returned-parts">Returned parts</h4>
          </div>
        </div>
        {!cases.length ? (
          <p className="unit-parts-notice">
            No returned parts are awaiting custody or review.
          </p>
        ) : (
          <ul className="unit-parts-list">
            {cases.map((caseItem) => (
              <li key={caseItem.id}>
                <div>
                  <strong>
                    {[
                      caseItem.partNumber,
                      caseItem.description,
                      caseItem.serialNumber,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Returned part"}
                  </strong>
                  <span>
                    {caseStage(caseItem.status)} · original workorder{" "}
                    <WorkorderLink
                      workorder={{
                        workorderId: caseItem.originalWorkorderId,
                        workorderSerial: caseItem.originalWorkorderSerial,
                      }}
                    />
                  </span>
                </div>
                {caseItem.status === "awaiting_handoff" ? (
                  <Button
                    type="button"
                    disabled={
                      busy ||
                      Boolean(pendingRequest) ||
                      !data?.capabilities?.receive
                    }
                    onClick={() => openForm("receive", caseItem)}
                  >
                    Receive
                  </Button>
                ) : null}
                {["received_pending_review", "hold"].includes(
                  caseItem.status,
                ) ? (
                  <Button
                    type="button"
                    disabled={
                      busy ||
                      Boolean(pendingRequest) ||
                      !data?.capabilities?.release
                    }
                    onClick={() => openForm("review", caseItem)}
                  >
                    {caseItem.status === "hold" ? "Review again" : "Review"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {data?.capabilities?.configure ? (
          <ReuseSetup
            companyId={scope.companyId}
            locationId={scope.locationId}
            onSaved={load}
          />
        ) : null}
      </section>
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
      {active?.kind === "remove" ? (
        <section
          className="unit-parts-form unit-parts-removal-form"
          aria-label="Remove tracked part"
          ref={removalFormRef}
        >
          <div className="unit-parts-removal-heading">
            <div>
              <h4>Remove part</h4>
              <strong>{partLabel(active.item)}</strong>
              <span>
                Installed on <WorkorderLink workorder={active.item} />
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
          {eligibleRemovalWorkordersForActive.length > 1 ? (
            <label>
              Removal workorder
              <Dropdown
                aria-label="Removal workorder"
                disabled={busy || Boolean(pendingRequest)}
                value={active.item.removalWorkorderId || ""}
                onChange={(event) =>
                  setActive((current) => ({
                    ...current,
                    item: {
                      ...current.item,
                      removalWorkorderId: event.target.value,
                    },
                  }))
                }
              >
                <option value="">Choose workorder</option>
                {eligibleRemovalWorkordersForActive.map((workorder) => (
                  <option value={workorder.id} key={workorder.id}>
                    {workorderLabel(workorder)}
                  </option>
                ))}
              </Dropdown>
            </label>
          ) : null}
          {!eligibleRemovalWorkordersForActive.length ? (
            <p className="unit-parts-notice">
              {data?.canCreateRemovalWorkorder
                ? "Workorder will be created automatically."
                : "Ask Office or Admin to assign an active workorder before removing this part."}
            </p>
          ) : null}
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
          {draft.ownership === "company" ? (
            <label>
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
            </label>
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
                (eligibleRemovalWorkordersForActive.length > 1 &&
                  !active.item.removalWorkorderId) ||
                (!eligibleRemovalWorkordersForActive.length &&
                  !data?.canCreateRemovalWorkorder) ||
                !draft.ownership ||
                (draft.ownership === "company" &&
                  !draft.ownershipEvidence.trim())
              }
            >
              {busy ? "Removing…" : "Remove part"}
            </Button>
          </div>
        </section>
      ) : null}
      {active?.kind === "receive" ? (
        <section className="unit-parts-form" aria-label="Receive returned part">
          <h4>2. Receive</h4>
          <p>
            Scan the exact QR first. Manual serial entry is available when the
            camera cannot be used.
          </p>
          <InventoryCodeScanner
            autoStart
            disabled={busy || Boolean(pendingRequest)}
            onScan={(code) =>
              resolveReceivedExact(code).catch((failure) =>
                setError(failure.message),
              )
            }
            labels={{
              openError: "This code could not be matched to the returned part.",
            }}
          />
          <label>
            Exact QR or serial <span>(manual fallback)</span>
            <input
              disabled={busy || Boolean(pendingRequest)}
              onChange={() => setReceivedExactUnitId("")}
              onBlur={(event) =>
                event.target.value.trim() &&
                resolveReceivedExact(event.target.value).catch((failure) =>
                  setError(failure.message),
                )
              }
            />
          </label>
          {receivedExactUnitId ? (
            <p role="status">Exact returned unit confirmed.</p>
          ) : (
            <p className="unit-parts-notice">
              Scan or validate the exact QR or serial before receiving.
            </p>
          )}
          <label>
            Receipt evidence
            <textarea
              disabled={busy || Boolean(pendingRequest)}
              rows="2"
              value={draft.evidence}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  evidence: event.target.value,
                }))
              }
            />
          </label>
          <div>
            <Button
              type="button"
              onClick={receive}
              disabled={
                busy ||
                Boolean(pendingRequest) ||
                !draft.evidence.trim() ||
                !receivedExactUnitId
              }
            >
              {busy ? "Saving…" : "Confirm receipt"}
            </Button>
            <Button
              type="button"
              disabled={busy || Boolean(pendingRequest)}
              onClick={closeForm}
            >
              Cancel
            </Button>
          </div>
        </section>
      ) : null}
      {active?.kind === "review" ? (
        <section className="unit-parts-form" aria-label="Review returned part">
          <h4>3. Review</h4>
          <label>
            Inspection evidence
            <textarea
              disabled={busy || Boolean(pendingRequest)}
              rows="2"
              value={draft.inspectionEvidence}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  inspectionEvidence: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Review reason <span>(required)</span>
            <textarea
              disabled={busy || Boolean(pendingRequest)}
              rows="2"
              value={draft.reviewReason}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  reviewReason: event.target.value,
                }))
              }
            />
          </label>
          <div>
            <Button
              type="button"
              onClick={() => review("release")}
              disabled={
                busy ||
                Boolean(pendingRequest) ||
                !canReleaseCase(active.item, data?.capabilities) ||
                !draft.inspectionEvidence.trim() ||
                !draft.reviewReason.trim()
              }
            >
              Release to stock
            </Button>
            <Button
              type="button"
              onClick={() => review("hold")}
              disabled={
                busy ||
                Boolean(pendingRequest) ||
                !draft.inspectionEvidence.trim() ||
                !draft.reviewReason.trim()
              }
            >
              Hold part
            </Button>
            <Button
              type="button"
              disabled={busy || Boolean(pendingRequest)}
              onClick={closeForm}
            >
              Cancel
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
