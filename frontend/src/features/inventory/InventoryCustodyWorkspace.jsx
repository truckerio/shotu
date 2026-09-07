import { useEffect, useMemo, useRef, useState } from "react";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Pagination } from "../../components/ui/Pagination.jsx";
import {
  SecondaryDetailPanel,
  SecondaryDetailSection,
} from "../../components/ui/SecondaryDetailPanel.jsx";
import {
  OperationalCollectionCell,
  OperationalCollectionResultHeader,
  OperationalCollectionRow,
  OperationalCollectionTable,
  OperationalCollectionTabs,
  OperationalCollectionToolbar,
} from "../../components/operations/OperationalCollectionPage.jsx";
import { api } from "../../lib/api.js";
import { InventoryCodeScanner } from "./InventoryCodeScanner.jsx";
import { ReuseSetup } from "./ReuseSetup.jsx";
import {
  clearCustodyRecovery,
  custodyCommandBody,
  custodyReleaseBlocker,
  readCustodyRecovery,
  saveCustodyRecovery,
} from "./inventory-custody-model.js";

const QUEUES = [
  ["awaiting_handoff", "Awaiting handoff"],
  ["needs_inspection", "Needs inspection"],
  ["repair_refurbish", "Repair/refurbish"],
  ["core_returns", "Core returns"],
  ["scrap_approval", "Scrap approval"],
  ["quarantine", "Quarantine"],
  ["completed", "Completed"],
];

const ROUTES = [
  ["inspect_for_reuse", "Inspect for reuse"],
  ["repair", "Repair/refurbish"],
  ["core_return", "Core return"],
  ["scrap", "Scrap"],
  ["not_sure", "Not sure"],
];
const RETURN_OUTCOMES = [
  ["reuse", "Ready to reuse"],
  ["repair", "Needs repair"],
  ["core_return", "Return as core"],
  ["scrap", "Scrap"],
  ["hold", "Keep on hold"],
];
const RETURN_BUTTONS = {
  reuse: "Return to inventory",
  repair: "Send to repair",
  core_return: "Prepare core return",
  scrap: "Mark for scrap",
  hold: "Keep on hold",
};
const CONDITIONS = {
  new: "New",
  serviceable_used: "Reusable",
  refurbished: "Refurbished",
  needs_repair: "Needs repair",
  unserviceable: "Unserviceable",
  unknown: "Not classified",
};
const REUSE_CASE_STATUS_LABELS = {
  awaiting_handoff: "Awaiting handoff",
  received_pending_review: "Needs inspection",
  hold: "On hold",
  repair: "Repair/refurbish",
  repair_complete_pending_review: "Repair complete — needs inspection",
  core_pending_return: "Core return pending",
  core_returned: "Core returned",
  scrap_pending_approval: "Scrap approval",
  scrapped: "Scrapped",
  quarantine: "Quarantine",
  released: "Returned to stock",
};
const reuseCaseStatusLabel = (caseItem) =>
  REUSE_CASE_STATUS_LABELS[caseItem?.workflowStatus || caseItem?.status] ||
  "Status not available";
const holder = (unit) =>
  unit?.custodyBinLocation
    ? `${unit.custodyHolderLabel || unit.custodyHolderType || "Location"} · ${unit.custodyBinLocation}`
    : unit?.custodyHolderLabel || unit?.custodyHolderType || "Not recorded";
const identity = (entry) =>
  [entry?.partNumber, entry?.description, entry?.serialNumber]
    .filter(Boolean)
    .join(" · ") || "Tracked part";
const availableUnit = (unit) => unit?.status === "in_stock" && unit?.custodyHolderType === "inventory_location" && (["new", "serviceable_used", "refurbished"].includes(unit?.conditionCode) || (unit?.conditionCode === "unknown" && unit?.custodyLegacyAvailable === true));
const hasStaleLocationDetail = (unit) =>
  Boolean(unit?.custodyBinLocation || unit?.custodyExternalReference);
const canCorrectLocationDetail = (unit) =>
  (unit?.status === "in_stock" && unit?.custodyHolderType === "inventory_location") ||
  (unit?.status === "removed" && unit?.custodyHolderType === "handoff" && hasStaleLocationDetail(unit));
const custodyEventContext = (event) => {
  const details = event?.details || {};
  return [
    details.evidence,
    details.receiptEvidence,
    details.externalReference,
    details.dispositionDate,
  ]
    .filter(Boolean)
    .join(" · ");
};

function apiPath(path, values) {
  const query = new URLSearchParams(
    Object.entries(values)
      .filter(
        ([, value]) => value !== "" && value !== null && value !== undefined,
      )
      .map(([key, value]) => [key, String(value)]),
  );
  return `${path}?${query}`;
}

function commandLabel(caseItem, capabilities = {}) {
  const status = caseItem?.workflowStatus || caseItem?.status;
  if (
    status === "awaiting_handoff" &&
    RETURN_OUTCOMES.some(([outcome]) =>
      returnOutcomeAllowed(outcome, caseItem, capabilities),
    )
  )
    return "Return part";
  if (
    ["received_pending_review", "needs_inspection"].includes(status) &&
    capabilities.route
  )
    return "Inspect and route";
  if (
    ["received_pending_review", "hold", "repair_complete_pending_review"].includes(status) &&
    capabilities.release
  )
    return caseItem?.reuseAllowed === true
      ? "Release to stock"
      : "Reuse setup required";
  if (status === "repair" && capabilities.repair)
    return caseItem?.repairStarted ? "Complete repair" : "Start repair";
  if (status === "core_pending_return" && capabilities.disposition)
    return "Confirm core return";
  if (status === "scrap_pending_approval" && capabilities.disposition)
    return "Confirm scrap";
  if (status === "quarantine" && capabilities.quarantine)
    return "Resolve quarantine";
  return "View details";
}

function statusForAction(caseItem, capabilities) {
  const status = caseItem?.workflowStatus || caseItem?.status;
  if (
    status === "awaiting_handoff" &&
    RETURN_OUTCOMES.some(([outcome]) =>
      returnOutcomeAllowed(outcome, caseItem, capabilities),
    )
  )
    return "return";
  if (
    ["received_pending_review", "needs_inspection"].includes(status) &&
    capabilities.route
  )
    return "route";
  if (
    ["received_pending_review", "hold", "repair_complete_pending_review"].includes(status) &&
    capabilities.release
  )
    return "release";
  if (status === "repair" && capabilities.repair)
    return caseItem?.repairStarted ? "repair/complete" : "repair/start";
  if (status === "core_pending_return" && capabilities.disposition)
    return "core-return";
  if (status === "scrap_pending_approval" && capabilities.disposition)
    return "scrap";
  if (status === "quarantine" && capabilities.quarantine)
    return "quarantine/resolve";
  return "";
}

function returnOutcomeAllowed(outcome, caseItem, capabilities) {
  if (!capabilities.receive) return false;
  if (outcome === "reuse")
    return Boolean(
      capabilities.release &&
        caseItem?.reuseAllowed &&
        caseItem?.ownership === "company" &&
        caseItem?.ownershipEvidence,
    );
  if (outcome === "hold") return Boolean(capabilities.release);
  const policy = {
    repair: "repairAllowed",
    core_return: "coreReturnAllowed",
    scrap: "scrapAllowed",
  }[outcome];
  return Boolean(capabilities.route && policy && caseItem?.[policy]);
}

function returnOutcomeReason(outcome, caseItem, capabilities) {
  if (!capabilities.receive) return "You do not have permission to receive returns.";
  if (outcome === "reuse" && caseItem?.ownership !== "company")
    return "Only company-owned parts can return to stock.";
  if (outcome === "reuse" && !caseItem?.reuseAllowed)
    return "Reuse is not approved for this part type.";
  if (outcome === "repair" && !caseItem?.repairAllowed)
    return "Repair is not approved for this part type.";
  if (outcome === "core_return" && !caseItem?.coreReturnAllowed)
    return "Core return is not approved for this part type.";
  if (outcome === "scrap" && !caseItem?.scrapAllowed)
    return "Scrap is not approved for this part type.";
  return "You do not have permission for this outcome.";
}

function defaultReturnOutcome(caseItem, capabilities) {
  const preferred = {
    inspect_for_reuse: "reuse",
    repair: "repair",
    core_return: "core_return",
    scrap: "scrap",
    not_sure: "hold",
  }[caseItem?.intendedRoute];
  return [preferred, "hold", "reuse", "repair", "core_return", "scrap"].find(
    (outcome) => outcome && returnOutcomeAllowed(outcome, caseItem, capabilities),
  ) || "hold";
}

export function InventoryCustodyWorkspace({
  locations = [],
  actorId = "",
  initialTab = "stock",
  hidePrimaryTabs = false,
}) {
  const [scopeId, setScopeId] = useState("");
  const [tab, setTab] = useState(initialTab);
  const [stock, setStock] = useState({
    items: [],
    counts: {},
    nextCursor: null,
    loading: false,
    error: "",
  });
  const [queue, setQueue] = useState({
    items: [],
    counts: {},
    nextCursor: null,
    loading: false,
    error: "",
  });
  const [stockCursor, setStockCursor] = useState([""]);
  const [queueCursor, setQueueCursor] = useState([""]);
  const [query, setQuery] = useState("");
  const [condition, setCondition] = useState("");
  const [queueStatus, setQueueStatus] = useState("awaiting_handoff");
  const [route, setRoute] = useState("");
  const [selectedPart, setSelectedPart] = useState(null);
  const [units, setUnits] = useState({
    items: [],
    nextCursor: null,
    loading: false,
    error: "",
  });
  const [unitCursor, setUnitCursor] = useState([""]);
  const [selectedCase, setSelectedCase] = useState(null);
  const [detail, setDetail] = useState(null);
  const [action, setAction] = useState("");
  const [draft, setDraft] = useState({
    evidence: "",
    binLocation: "",
    route: "inspect_for_reuse",
    handlerType: "internal",
    handlerReference: "",
    externalReference: "",
    dispositionDate: "",
    holderType: "inventory_location",
    reason: "",
    outcome: "hold",
    note: "",
    serial: "",
  });
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [exactIdentityId, setExactIdentityId] = useState("");
  const [pendingRequest, setPendingRequest] = useState(null);
  const [retryAllowed, setRetryAllowed] = useState(false);
  const [requestedPolicyPart, setRequestedPolicyPart] = useState(null);
  const refreshRef = useRef(0);
  const scope = useMemo(
    () => locations.find((location) => location.id === scopeId) || null,
    [locations, scopeId],
  );
  const companyId = scope?.companyId || scope?.company_id || "";
  const locationId = scope?.id || "";
  const scopeReady = Boolean(companyId && locationId);
  const currentStockCursor = stockCursor.at(-1);
  const currentQueueCursor = queueCursor.at(-1);
  const currentUnitCursor = unitCursor.at(-1);

  useEffect(() => {
    if (!scopeId && locations.length === 1) setScopeId(locations[0].id);
  }, [locations, scopeId]);
  useEffect(() => {
    setStockCursor([""]);
    setQueueCursor([""]);
    setSelectedPart(null);
    setSelectedCase(null);
    setExactIdentityId("");
  }, [scopeId, query, condition, queueStatus, route]);

  useEffect(() => {
    if (!scopeReady || tab !== "stock") return undefined;
    let active = true;
    setStock((current) => ({ ...current, loading: true, error: "" }));
    const timer = window.setTimeout(
      () =>
        api(
          apiPath("/api/inventory-reuse/stock", {
            companyId,
            locationId,
            q: query.trim(),
            condition,
            limit: 25,
            cursor: currentStockCursor,
          }),
        )
          .then(
            (result) =>
              active &&
              setStock({
                items: result.items || [],
                counts: result.counts || {},
                nextCursor: result.nextCursor || null,
                capabilities: result.capabilities || {},
                loading: false,
                error: "",
              }),
          )
          .catch(
            (error) =>
              active &&
              setStock((current) => ({
                ...current,
                loading: false,
                error: error.message || "Stock could not be loaded.",
              })),
          ),
      160,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    scopeReady,
    tab,
    companyId,
    locationId,
    query,
    condition,
    currentStockCursor,
    refreshRef.current,
  ]);

  useEffect(() => {
    if (!scopeReady || tab !== "returns") return undefined;
    let active = true;
    setQueue((current) => ({ ...current, loading: true, error: "" }));
    const timer = window.setTimeout(
      () =>
        api(
          apiPath("/api/inventory-reuse/queue", {
            companyId,
            locationId,
            q: query.trim(),
            status: queueStatus,
            route,
            limit: 25,
            cursor: currentQueueCursor,
          }),
        )
          .then(
            (result) =>
              active &&
              setQueue({
                items: result.items || [],
                counts: result.counts || {},
                nextCursor: result.nextCursor || null,
                capabilities: result.capabilities || {},
                loading: false,
                error: "",
              }),
          )
          .catch(
            (error) =>
              active &&
              setQueue((current) => ({
                ...current,
                loading: false,
                error:
                  error.message || "Returns and repairs could not be loaded.",
              })),
          ),
      160,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    scopeReady,
    tab,
    companyId,
    locationId,
    query,
    queueStatus,
    route,
    currentQueueCursor,
    refreshRef.current,
  ]);

  useEffect(() => {
    if (!scopeReady || !selectedPart?.catalogPartId) return undefined;
    let active = true;
    setUnits((current) => ({ ...current, loading: true, error: "" }));
    api(
      apiPath(
        `/api/inventory-reuse/stock/${encodeURIComponent(selectedPart.catalogPartId)}/units`,
        {
          companyId,
          locationId,
          q: query.trim(),
          condition,
          limit: 25,
          cursor: currentUnitCursor,
        },
      ),
    )
      .then(
        (result) =>
          active &&
          setUnits({
            items: result.items || [],
            nextCursor: result.nextCursor || null,
            capabilities: result.capabilities || {},
            loading: false,
            error: "",
          }),
      )
      .catch(
        (error) =>
          active &&
          setUnits((current) => ({
            ...current,
            loading: false,
            error: error.message || "Exact units could not be loaded.",
          })),
      );
    return () => {
      active = false;
    };
  }, [
    scopeReady,
    selectedPart?.catalogPartId,
    companyId,
    locationId,
    query,
    condition,
    currentUnitCursor,
    refreshRef.current,
  ]);

  async function openCase(caseItem) {
    setSelectedCase(caseItem);
    setDetail(null);
    setActionError("");
    setAction("");
    setExactIdentityId("");
    setRetryAllowed(false);
    const saved = readCustodyRecovery(window.sessionStorage, {
      actorId,
      companyId,
      locationId,
      caseId: caseItem.id,
    });
    setPendingRequest(saved);
    if (saved)
      setActionError(
        "A previous custody request needs its outcome checked before any retry.",
      );
    const unitId =
      caseItem.serializedUnitId || caseItem.unitId || caseItem.inventoryUnitId;
    if (!unitId || !scopeReady) return;
    try {
      const loaded = await api(
        apiPath(`/api/inventory-reuse/units/${encodeURIComponent(unitId)}`, {
          companyId,
          locationId,
        }),
      );
      setDetail(loaded);
      const loadedCase = loaded.case || caseItem;
      if (
        !saved &&
        (loadedCase.workflowStatus || loadedCase.status) === "awaiting_handoff" &&
        RETURN_OUTCOMES.some(([outcome]) =>
          returnOutcomeAllowed(outcome, loadedCase, loaded.capabilities || {}),
        )
      ) {
        setAction("return");
        setDraft((current) => ({
          ...current,
          outcome: defaultReturnOutcome(loadedCase, loaded.capabilities || {}),
          note: "",
          serial: "",
        }));
      }
    } catch (error) {
      setActionError(
        error.message || "Exact-unit details could not be loaded.",
      );
    }
  }
  async function execute() {
    const caseItem = selectedCase?.case || selectedCase;
    const caseId = caseItem?.id;
    if (
      (!caseId && action !== "location-correction") ||
      !action ||
      saving ||
      pendingRequest
    )
      return;
    if (["return", "receive", "repair/complete"].includes(action) && !exactIdentityId) {
      setActionError(
        "Scan or validate the exact QR or serial before receiving this part.",
      );
      return;
    }
    if (action === "return" && !returnOutcomeAllowed(draft.outcome, activeCase, caps)) {
      setActionError(returnOutcomeReason(draft.outcome, activeCase, caps));
      return;
    }
    const body = custodyCommandBody({
      action,
      scope: { companyId, locationId },
      caseItem,
      detail,
      draft,
      exactIdentityId,
      idempotencyKey: crypto.randomUUID(),
    });
    if (action === "receive")
      Object.assign(body, {
        actualHolderType: "inventory_location",
        actualLocationId: locationId,
        exactUnitId: exactIdentityId,
        ...(draft.binLocation.trim()
          ? { binLocation: draft.binLocation.trim() }
          : {}),
        correctedRoute: draft.route,
      });
    if (action === "repair/complete") Object.assign(body, { exactUnitId: exactIdentityId, receiptEvidence: draft.receiptEvidence.trim(), binLocation: draft.binLocation.trim() });
    if (action === "route") Object.assign(body, { route: draft.route });
    if (action === "repair/start")
      Object.assign(body, {
        handlerType: draft.handlerType,
        handlerReference: draft.handlerReference.trim(),
      });
    if (action === "quarantine/resolve" && draft.route === "not_sure")
      body.resolution = "inspect_for_reuse";
    if (action === "location-correction")
      Object.assign(body, {
        unitId: detail?.unit?.id,
        custodyVersion: detail?.unit?.custodyVersion,
        holderType: draft.holderType,
        binLocation: draft.binLocation.trim(),
      });
    const request = {
      path:
        action === "location-correction"
          ? "/api/inventory-reuse/location-correction"
          : `/api/inventory-reuse/${encodeURIComponent(caseId)}/${action}`,
      body,
    };
    const recoveryScope = { actorId, companyId, locationId, caseId };
    if (!saveCustodyRecovery(window.sessionStorage, recoveryScope, request)) {
      setActionError("This action cannot be saved until session storage is available.");
      return;
    }
    setPendingRequest(request);
    setSaving(true);
    setActionError("");
    try {
      await api(request.path, {
        method: "POST",
        body: JSON.stringify(request.body),
      });
      clearCustodyRecovery(window.sessionStorage, recoveryScope);
      setPendingRequest(null);
      setRetryAllowed(false);
      setAction("");
      setSelectedCase(null);
      setDetail(null);
      refreshRef.current += 1;
      setStockCursor([""]);
      setQueueCursor([""]);
    } catch (error) {
      if (!error.status || error.status >= 500)
        setActionError(
          `${error.message || "The outcome is unknown."} Check the saved request before retrying.`,
        );
      else if (error.status === 409) {
        clearCustodyRecovery(window.sessionStorage, recoveryScope);
        setPendingRequest(null);
        setRetryAllowed(false);
        await openCase(caseItem);
        setActionError(
          `${error.message} Reloaded the latest record; review it before trying again.`,
        );
      } else {
        clearCustodyRecovery(window.sessionStorage, recoveryScope);
        setPendingRequest(null);
        setRetryAllowed(false);
        setActionError(error.message || "The action could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  }
  async function reconcile() {
    if (!pendingRequest || saving) return;
    setSaving(true);
    setActionError("");
    try {
      await api(
        apiPath(
          `/api/inventory-reuse/operations/${encodeURIComponent(pendingRequest.body.idempotencyKey)}`,
          { companyId, locationId },
        ),
      );
      clearCustodyRecovery(window.sessionStorage, {
        actorId,
        companyId,
        locationId,
        caseId: selectedCase?.id,
      });
      setPendingRequest(null);
      setRetryAllowed(false);
      setAction("");
      setSelectedCase(null);
      refreshRef.current += 1;
    } catch (error) {
      if (error.code === "INVENTORY_REUSE_OPERATION_NOT_FOUND")
        setRetryAllowed(true);
      setActionError(
        error.code === "INVENTORY_REUSE_OPERATION_NOT_FOUND"
          ? "No committed operation was found. You may retry the saved request."
          : `${error.message} Do not retry until its status is known.`,
      );
    } finally {
      setSaving(false);
    }
  }
  async function retrySavedRequest() {
    if (!pendingRequest || !retryAllowed || saving) return;
    const caseItem = selectedCase?.case || selectedCase;
    const recoveryScope = {
      actorId,
      companyId,
      locationId,
      caseId: caseItem?.id,
    };
    setSaving(true);
    setActionError("");
    setRetryAllowed(false);
    try {
      await api(pendingRequest.path, {
        method: "POST",
        body: JSON.stringify(pendingRequest.body),
      });
      clearCustodyRecovery(window.sessionStorage, recoveryScope);
      setPendingRequest(null);
      setAction("");
      await openCase(caseItem);
      refreshRef.current += 1;
      setStockCursor([""]);
      setQueueCursor([""]);
    } catch (error) {
      if (error.status === 409) {
        clearCustodyRecovery(window.sessionStorage, recoveryScope);
        setPendingRequest(null);
        await openCase(caseItem);
        setActionError(
          `${error.message} Reloaded the latest record; review it before trying again.`,
        );
      } else {
        setActionError(
          !error.status || error.status >= 500
            ? `${error.message || "The outcome is unknown."} Check the saved request before retrying.`
            : error.message || "The saved request could not be replayed.",
        );
      }
    } finally {
      setSaving(false);
    }
  }
  async function resolveExact(rawCode) {
    const result = await api(
      apiPath("/api/inventory-reuse/scan", {
        companyId,
        locationId,
        code: rawCode,
      }),
    );
    const scanned = result.unit || result;
    const expectedId =
      detail?.unit?.id ||
      activeCase?.serializedUnitId ||
      activeCase?.unitId ||
      activeCase?.inventoryUnitId;
    if (!scanned?.id || (expectedId && scanned.id !== expectedId))
      throw new Error("That serial does not match this returned part.");
    setDetail((current) => ({ ...(current || {}), unit: scanned }));
    setExactIdentityId(scanned.id);
  }
  const caps =
    detail?.capabilities ||
    (tab === "stock" ? stock.capabilities : queue.capabilities) ||
    {};
  const activeCase = detail?.case || selectedCase;
  const nextAction = statusForAction(activeCase, caps);
  const releaseBlocker = custodyReleaseBlocker(activeCase, caps);
  const releaseGuidance = releaseBlocker ? (
    <div className="inventory-custody-guidance" role="status" aria-live="polite">
      <strong>{releaseBlocker.title}</strong>
      <p>{releaseBlocker.message}</p>
      <p>{releaseBlocker.nextStep}</p>
      {caps.configure ? (
        <Button
          type="button"
          variant="primary"
          onClick={() => {
            setRequestedPolicyPart({
              requestId: crypto.randomUUID(),
              id: activeCase.catalogPartId || detail?.unit?.catalogPartId,
              partNumber: activeCase.partNumber,
              description: activeCase.description,
            });
            setSelectedCase(null);
            setDetail(null);
          }}
        >
          Open Reuse settings for this part
        </Button>
      ) : null}
    </div>
  ) : null;
  const isAwaitingReturn =
    (activeCase?.workflowStatus || activeCase?.status) === "awaiting_handoff";
  const page = tab === "stock" ? stockCursor.length : queueCursor.length;
  const state = tab === "stock" ? stock : queue;
  return (
    <section
      className="inventory-custody"
      aria-label="Inventory custody"
      data-actor-id={actorId || undefined}
    >
      {!hidePrimaryTabs ? (
        <OperationalCollectionTabs
          ariaLabel="Inventory sections"
          activeId={tab}
          onChange={setTab}
          items={[
            { id: "stock", label: "Stock" },
            { id: "returns", label: "Returns & repairs" },
          ]}
        />
      ) : null}
      <OperationalCollectionToolbar className="inventory-toolbar inventory-custody-toolbar">
        <label className="inventory-toolbar-field">
          <span>Location</span>
          <Dropdown
            value={scopeId}
            onChange={(event) => setScopeId(event.target.value)}
            aria-label="Inventory location"
          >
            <option value="">Choose a location</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Dropdown>
        </label>
        <label className="inventory-toolbar-field inventory-search-field">
          <span>Search</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              tab === "stock"
                ? "Part, serial, or description"
                : "Part, serial, or holder"
            }
          />
        </label>
        {tab === "stock" ? (
          <label className="inventory-toolbar-field">
            <span>Condition</span>
            <Dropdown
              aria-label="Filter stock by condition"
              value={condition}
              onChange={(event) => setCondition(event.target.value)}
            >
              <option value="">All conditions</option>
              {Object.entries(CONDITIONS).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </Dropdown>
          </label>
        ) : (
          <label className="inventory-toolbar-field">
            <span>Route</span>
            <Dropdown
              aria-label="Filter returns by route"
              value={route}
              onChange={(event) => setRoute(event.target.value)}
            >
              <option value="">All routes</option>
              {ROUTES.map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </Dropdown>
          </label>
        )}
      </OperationalCollectionToolbar>
      {!scopeReady ? (
        <p className="inventory-empty" role="status">
          Choose one authorized location to view custody and take actions.
        </p>
      ) : (
        <>
          {tab === "returns" ? (
            <OperationalCollectionTabs
              ariaLabel="Returns and repairs queues"
              activeId={queueStatus}
              onChange={setQueueStatus}
              items={QUEUES.map(([id, label]) => ({
                id,
                label,
                count: queue.counts?.[id] ?? "-",
              }))}
            />
          ) : null}
          {state.error ? (
            <p className="ops-error" role="alert">
              {state.error}
            </p>
          ) : null}
          <OperationalCollectionResultHeader>
            <span role="status">
              {state.loading
                ? "Updating results…"
                : tab === "stock"
                  ? `${stock.items.length} catalog parts`
                  : `${queue.items.length} returned parts`}
            </span>
          </OperationalCollectionResultHeader>
          {tab === "stock" ? (
            <OperationalCollectionTable
              ariaLabel="Stock by catalog part"
              busy={stock.loading}
              columns={[
                { id: "part", label: "Part" },
                { id: "available", label: "Available" },
                { id: "reserved", label: "Reserved" },
                { id: "installed", label: "Installed" },
                { id: "attention", label: "Needs attention" },
              ]}
            >
              {stock.items.map((item) => (
                <OperationalCollectionRow
                  key={item.catalogPartId}
                  onAction={() => {
                    setSelectedPart(item);
                    setUnitCursor([""]);
                  }}
                  ariaLabel={`Open ${identity(item)}`}
                >
                  <OperationalCollectionCell label="Part">
                    <strong>{item.partNumber || "Part"}</strong>
                    <small>{item.description || "No description"}</small>
                  </OperationalCollectionCell>
                  <OperationalCollectionCell label="Available">
                    {item.ready ?? 0}
                  </OperationalCollectionCell>
                  <OperationalCollectionCell label="Reserved">
                    {item.reserved ?? 0}
                  </OperationalCollectionCell>
                  <OperationalCollectionCell label="Installed">
                    {item.installed ?? 0}
                  </OperationalCollectionCell>
                  <OperationalCollectionCell label="Needs attention">
                    {item.actionNeeded ?? 0}
                  </OperationalCollectionCell>
                </OperationalCollectionRow>
              ))}
            </OperationalCollectionTable>
          ) : (
            <OperationalCollectionTable
              ariaLabel="Returns and repairs"
              busy={queue.loading}
              columns={[
                { id: "part", label: "Part / serial" },
                { id: "holder", label: "Where it is" },
                { id: "route", label: "Queue" },
                { id: "age", label: "Age" },
                { id: "next", label: "Next action" },
              ]}
            >
              {queue.items.map((item) => (
                <OperationalCollectionRow
                  key={item.id}
                  onAction={() => openCase(item)}
                  ariaLabel={`Open ${identity(item)}`}
                >
                  <OperationalCollectionCell label="Part / serial">
                    <strong>{identity(item)}</strong>
                  </OperationalCollectionCell>
                  <OperationalCollectionCell label="Where it is">
                    {holder(item)}
                  </OperationalCollectionCell>
                  <OperationalCollectionCell label="Queue">
                    {reuseCaseStatusLabel(item)}
                  </OperationalCollectionCell>
                  <OperationalCollectionCell label="Age">
                    {item.ageLabel || item.age || "—"}
                  </OperationalCollectionCell>
                  <OperationalCollectionCell label="Next action">
                    {commandLabel(item, queue.capabilities || {})}
                  </OperationalCollectionCell>
                </OperationalCollectionRow>
              ))}
            </OperationalCollectionTable>
          )}
          {!state.loading && !state.items.length ? (
            <p className="inventory-empty">
              No matching records at this location.
            </p>
          ) : null}
          <Pagination
            currentPage={page}
            pageCount={state.nextCursor ? page + 1 : page}
            setPage={(next) => {
              const stack = tab === "stock" ? stockCursor : queueCursor;
              const setter = tab === "stock" ? setStockCursor : setQueueCursor;
              if (next < stack.length) setter(stack.slice(0, next));
              else if (state.nextCursor) setter([...stack, state.nextCursor]);
            }}
            total={0}
            label="records"
            loading={state.loading}
          />
          {caps.configure ? (
            <ReuseSetup
              companyId={companyId}
              locationId={locationId}
              requestedPolicyPart={requestedPolicyPart}
              onSaved={() => {
                refreshRef.current += 1;
                setQueueCursor([""]);
              }}
            />
          ) : null}
        </>
      )}
      <SecondaryDetailPanel
        open={Boolean(selectedPart)}
        onOpenChange={(open) => !open && setSelectedPart(null)}
        title={selectedPart?.partNumber || "Part"}
        eyebrow="Exact units"
        footer={
          <Button type="button" onClick={() => setSelectedPart(null)}>
            Close
          </Button>
        }
      >
        {selectedPart ? (
          <>
            <SecondaryDetailSection title="Stock">
              <div className="inventory-detail-metrics">
                <div>
                  <span>Available</span>
                  <strong>{selectedPart.exact?.ready ?? 0}</strong>
                </div>
                <div>
                  <span>Reserved</span>
                  <strong>{selectedPart.exact?.reserved ?? 0}</strong>
                </div>
                <div>
                  <span>Installed</span>
                  <strong>{selectedPart.exact?.installed ?? 0}</strong>
                </div>
                <div>
                  <span>Needs attention</span>
                  <strong>{selectedPart.exact?.actionNeeded ?? 0}</strong>
                </div>
              </div>
              <p className="inventory-serial-note">
                Available is governed exact stock. New, Reusable, Refurbished,
                and Unclassified remain separate conditions.
              </p>
            </SecondaryDetailSection>
            <SecondaryDetailSection title="Exact units">
              {units.error ? <p role="alert">{units.error}</p> : null}
              {units.loading ? (
                <p role="status">Loading exact units…</p>
              ) : (
                <ul className="inventory-custody-units">
                  {units.items.map((unit) => (
                    <li key={unit.id}>
                      <strong>{unit.serialNumber || unit.id}</strong>
                      <span>
                        {CONDITIONS[unit.conditionCode] || "Not classified"} ·{" "}
                        {holder(unit)} ·{" "}
                        {availableUnit(unit) ? "Available" : "Not available"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {!units.loading && !units.items.length ? (
                <p>No exact units match this filter.</p>
              ) : null}
            </SecondaryDetailSection>
          </>
        ) : null}
      </SecondaryDetailPanel>
      <SecondaryDetailPanel
        open={Boolean(selectedCase)}
        onOpenChange={(open) => !open && !saving && setSelectedCase(null)}
        closeDisabled={saving}
        dismissable={!saving}
        title={
          detail?.unit?.serialNumber ||
          selectedCase?.serialNumber ||
          "Returned part"
        }
        eyebrow="Returns & repairs"
        footer={
          <Button
            type="button"
            onClick={() => setSelectedCase(null)}
            disabled={saving}
          >
            Close
          </Button>
        }
      >
        {!isAwaitingReturn || pendingRequest ? (
        <SecondaryDetailSection title="Current status">
          <dl className="inventory-detail-facts">
            <div>
              <dt>Condition</dt>
              <dd>
                {CONDITIONS[detail?.unit?.conditionCode] || "Not classified"}
              </dd>
            </div>
            <div>
              <dt>Where it is</dt>
              <dd>{holder(detail?.unit || selectedCase)}</dd>
            </div>
            <div>
              <dt>Availability</dt>
              <dd>{availableUnit(detail?.unit) ? "Available" : "Not available"}</dd>
            </div>
            <div>
              <dt>Next action</dt>
              <dd>{commandLabel(activeCase, caps)}</dd>
            </div>
          </dl>
          {pendingRequest ? (
            <p role="alert">
              A saved request needs its outcome checked.{" "}
              <Button type="button" onClick={reconcile} disabled={saving}>
                Check saved request
              </Button>
              {retryAllowed ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={retrySavedRequest}
                  disabled={saving}
                >
                  Retry saved request
                </Button>
              ) : null}
            </p>
          ) : null}
        </SecondaryDetailSection>
        ) : null}
      {!pendingRequest && detail?.unit && caps.route && canCorrectLocationDetail(detail.unit) ? (
          <SecondaryDetailSection title="Correct location detail">
            {action !== "location-correction" ? (
              <div className="inventory-custody-actions">
                <Button
                  type="button"
                  onClick={() => {
                    const isHandoff = detail.unit.status === "removed" && detail.unit.custodyHolderType === "handoff";
                    setAction("location-correction");
                    setExactIdentityId(""); setDraft({
                      evidence: "",
                      binLocation: isHandoff ? "" : detail.unit.custodyBinLocation || "",
                      route: "inspect_for_reuse",
                      handlerType: "internal",
                      handlerReference: "",
                      externalReference: "",
                      holderType: detail.unit.custodyHolderType,
                      reason: "",
                    });
                  }}
                >
                  {detail.unit.status === "removed" && detail.unit.custodyHolderType === "handoff"
                    ? "Clear stale location detail"
                    : "Correct bin"}
                </Button>
              </div>
            ) : (
              <div className="inventory-custody-form">
                {detail.unit.status === "removed" && detail.unit.custodyHolderType === "handoff" ? (
                  <p>
                    This clears stale bin or external-reference detail while
                    preserving Handoff custody. It does not receive, route,
                    release, or transfer this part.
                  </p>
                ) : (
                  <label>
                    Bin or shelf <span>(optional)</span>
                    <input
                      value={draft.binLocation}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          binLocation: event.target.value,
                        }))
                      }
                    />
                  </label>
                )}
                <label>
                  Correction evidence
                  <textarea
                    rows="3"
                    value={draft.evidence}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        evidence: event.target.value,
                      }))
                    }
                  />
                </label>
                <div>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={saving || !draft.evidence.trim()}
                    onClick={execute}
                  >
                    {saving ? "Saving…" : "Save correction"}
                  </Button>
                  <Button
                    type="button"
                    disabled={saving}
                    onClick={() => setAction("")}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </SecondaryDetailSection>
        ) : null}
        {!isAwaitingReturn && detail?.timeline?.length ? (
          <SecondaryDetailSection title="History">
            <ol className="inventory-custody-timeline">
              {detail.timeline.map((event, index) => (
                <li key={event.id || index}>
                  <strong>
                    {event.label || event.eventType || event.type || "Updated"}
                  </strong>
                  <span>
                    {event.at
                      ? new Date(event.at).toLocaleString()
                      : "Recorded"}
                    {event.actorName ? ` · ${event.actorName}` : ""}
                  </span>
                  {custodyEventContext(event) ? (
                    <p>{custodyEventContext(event)}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </SecondaryDetailSection>
        ) : null}
        {!pendingRequest && nextAction ? (
          <SecondaryDetailSection
            title={action === "return" ? "Return part" : action ? "Complete action" : "Next action"}
          >
            {!action ? (
              <div className="inventory-custody-actions">
                {nextAction === "release" && releaseGuidance ? releaseGuidance : (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => {
                      setAction(nextAction);
                      setDraft({
                        evidence: "",
                        binLocation: "",
                        route: "inspect_for_reuse",
                        handlerType: "internal",
                        handlerReference: "",
                        externalReference: "",
                        dispositionDate: "",
                        reason: "",
                        outcome: defaultReturnOutcome(activeCase, caps),
                        note: "",
                        serial: "",
                      });
                    }}
                  >
                    {commandLabel(activeCase, caps)}
                  </Button>
                )}
                {["route", "repair/complete"].includes(nextAction) &&
                caps.release && !releaseBlocker ? (
                  <Button type="button" onClick={() => setAction("release")}>
                    Release to stock
                  </Button>
                ) : null}
                {nextAction !== "release" ? releaseGuidance : null}
              </div>
            ) : (
              <div className="inventory-custody-form">
                {["return", "receive", "repair/complete"].includes(action) ? (
                  <>
                    <p>
                      Scan the exact QR first. Manual entry remains available
                      when the camera cannot be used.
                    </p>
                    <InventoryCodeScanner
                      autoStart
                      disabled={saving}
                      onScan={resolveExact}
                      labels={{
                        openError:
                          "This code could not be matched to the returned part.",
                      }}
                    />
                    <label>
                      Exact QR or serial <span>(manual fallback)</span>
                      <input
                        value={draft.serial || ""}
                        onChange={(event) =>
                          (setExactIdentityId(""), setDraft((current) => ({
                            ...current,
                            serial: event.target.value,
                          })))
                        }
                        onBlur={(event) =>
                          event.target.value.trim() &&
                          resolveExact(event.target.value).catch((error) =>
                            setActionError(error.message),
                          )
                        }
                        disabled={saving}
                      />
                    </label>
                    {exactIdentityId ? (
                      <p role="status">
                        Matched serial {detail?.unit?.serialNumber || "confirmed"}.
                      </p>
                    ) : null}
                    {action === "repair/complete" ? <><label>Physical return evidence<textarea rows="2" value={draft.receiptEvidence || ""} onChange={(event) => setDraft((current) => ({ ...current, receiptEvidence: event.target.value }))} disabled={saving} /></label><label>Bin or shelf<input value={draft.binLocation} onChange={(event) => setDraft((current) => ({ ...current, binLocation: event.target.value }))} disabled={saving} /></label></> : null}
                  </>
                ) : null}
                {action === "return" ? (
                  <>
                    <label>
                      Condition
                      <Dropdown
                        aria-label="Returned part condition"
                        value={draft.outcome}
                        onChange={(event) => {
                          setActionError("");
                          setDraft((current) => ({ ...current, outcome: event.target.value }));
                        }}
                        disabled={saving}
                      >
                        {RETURN_OUTCOMES.map(([value, label]) => (
                          <option
                            key={value}
                            value={value}
                            disabled={!returnOutcomeAllowed(value, activeCase, caps)}
                          >
                            {label}
                          </option>
                        ))}
                      </Dropdown>
                    </label>
                    {!returnOutcomeAllowed(draft.outcome, activeCase, caps) ? (
                      <p className="inventory-custody-guidance" role="status">
                        {returnOutcomeReason(draft.outcome, activeCase, caps)}
                      </p>
                    ) : null}
                    <details className="inventory-custody-optional">
                      <summary>Add note</summary>
                      <label>
                        Note
                        <textarea
                          rows="2"
                          value={draft.note}
                          onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
                          disabled={saving}
                        />
                      </label>
                    </details>
                  </>
                ) : (
                  <label>
                    Evidence
                    <textarea
                      rows="3"
                      value={draft.evidence}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          evidence: event.target.value,
                        }))
                      }
                      disabled={saving}
                    />
                  </label>
                )}
                {["receive", "route", "quarantine/resolve"].includes(action) ? (
                  <label>
                    Route
                    <Dropdown
                      aria-label="Next action"
                      value={draft.route}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          route: event.target.value,
                        }))
                      }
                      disabled={saving}
                    >
                      {ROUTES.filter(
                        ([value]) =>
                          action !== "quarantine/resolve" ||
                          value !== "not_sure",
                      ).map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </Dropdown>
                  </label>
                ) : null}
                {["receive", "release"].includes(action) ? (
                  <label>
                    Bin or shelf <span>(optional)</span>
                    <input
                      value={draft.binLocation}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          binLocation: event.target.value,
                        }))
                      }
                      disabled={saving}
                    />
                  </label>
                ) : null}
                {action === "repair/start" ? (
                  <>
                    <label>
                      Repair handler
                      <Dropdown
                        aria-label="Repair handler"
                        value={draft.handlerType}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            handlerType: event.target.value,
                          }))
                        }
                        disabled={saving}
                      >
                        <option value="internal">Internal repair</option>
                        <option value="external">External vendor</option>
                      </Dropdown>
                    </label>
                    <label>
                      Vendor or area
                      <input
                        value={draft.handlerReference}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            handlerReference: event.target.value,
                          }))
                        }
                        disabled={saving}
                      />
                    </label>
                  </>
                ) : null}
                {action === "release" ? (
                  <label>
                    Inspection decision
                    <input
                      value={draft.reason}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          reason: event.target.value,
                        }))
                      }
                      disabled={saving}
                    />
                  </label>
                ) : null}
                {["core-return", "scrap"].includes(action) ? (
                  <>
                    <label>
                      {action === "core-return"
                        ? "Core return reference"
                        : "Scrap destination or reference"}{" "}
                      <span>(required)</span>
                      <input
                        value={draft.externalReference}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            externalReference: event.target.value,
                          }))
                        }
                        disabled={saving}
                      />
                    </label>
                    <label>
                      {action === "core-return"
                        ? "Core return date"
                        : "Scrap date"}{" "}
                      <span>(required)</span>
                      <input
                        type="date"
                        value={draft.dispositionDate}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            dispositionDate: event.target.value,
                          }))
                        }
                        disabled={saving}
                      />
                    </label>
                  </>
                ) : null}
                {actionError ? <p role="alert">{actionError}</p> : null}
                <div>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={
                      saving ||
                      (action !== "return" && !draft.evidence.trim()) ||
                      (action === "return" &&
                        (!exactIdentityId ||
                          !returnOutcomeAllowed(draft.outcome, activeCase, caps))) ||
                      (action === "receive" && !exactIdentityId) ||
                      (action === "repair/complete" && (!exactIdentityId || !draft.receiptEvidence?.trim())) ||
                      (action === "repair/start" && !draft.handlerReference.trim()) ||
                      (action === "release" && !draft.reason.trim()) ||
                      (["core-return", "scrap"].includes(action) &&
                        (!draft.externalReference.trim() ||
                          !draft.dispositionDate))
                    }
                    onClick={execute}
                  >
                    {saving
                      ? "Saving…"
                      : action === "return"
                        ? RETURN_BUTTONS[draft.outcome] || "Return part"
                        : "Confirm"}
                  </Button>
                  <Button
                    type="button"
                    disabled={saving}
                    onClick={() => setAction("")}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </SecondaryDetailSection>
        ) : null}
      </SecondaryDetailPanel>
    </section>
  );
}
