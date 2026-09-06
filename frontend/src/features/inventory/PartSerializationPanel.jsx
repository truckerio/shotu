import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Plus,
  Printer,
  QrCode01,
  RefreshCw01,
  XClose,
} from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { Pagination } from "../../components/ui/Pagination.jsx";
import { api } from "../../lib/api.js";
import { serializedUnitSourceView } from "./part-serialization-source-model.js";

function quantity(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(
    Number(value || 0),
  );
}

function unitStatus(status) {
  return (
    {
      in_stock: "In stock",
      issued: "Issued",
      installed: "Installed",
      removed: "Removed",
      returned: "Returned",
      scrapped: "Scrapped",
      pending: "Pending",
    }[status] || status
  );
}

function eventLabel(type) {
  return (
    {
      receipt_staged: "Receipt staged",
      receipt_confirmed: "Receipt confirmed",
      receipt_recorded: "Created",
      reconciliation_required: "Reconciliation required",
      issued: "Issued to work order",
      installed: "Installed",
      returned: "Returned",
      void: "Voided",
    }[type] || String(type || "Updated").replaceAll("_", " ")
  );
}

function eventContext(event) {
  const references = [];
  if (event.workorderSerial)
    references.push(`Work order ${event.workorderSerial}`);
  const asset = event.asset?.unitNo || event.asset?.name;
  if (asset) references.push(`Unit ${asset}`);
  if (!references.length && event.providerReference)
    references.push(event.providerReference);
  return references.join(" · ");
}

function custodyEventContext(event) {
  const details = event?.details || {};
  return [
    details.evidence,
    details.receiptEvidence,
    details.externalReference,
    details.dispositionDate,
  ]
    .filter(Boolean)
    .join(" · ");
}

function dateTime(value) {
  if (!value) return "Unknown time";
  return new Date(value).toLocaleString();
}

function custodyHolder(unit) {
  if (unit?.custodyHolderLabel) return unit.custodyHolderLabel;
  const base = unit?.custodyHolderType || unit?.locationName || "";
  return unit?.custodyBinLocation
    ? `${base} · ${unit.custodyBinLocation}`
    : base;
}

const CONDITION_LABELS = {
  new: "New",
  serviceable_used: "Reusable",
  refurbished: "Refurbished",
  needs_repair: "Needs repair",
  unserviceable: "Unserviceable",
  unknown: "Not classified",
};
const isAvailableForUse = (unit) =>
  unit?.status === "in_stock" &&
  unit?.custodyHolderType === "inventory_location" &&
  (["new", "serviceable_used", "refurbished"].includes(unit?.conditionCode) ||
    (unit?.conditionCode === "unknown" && unit?.custodyLegacyAvailable === true));

function reusePath(path, values) {
  const query = new URLSearchParams(
    Object.entries(values)
      .filter(
        ([, value]) => value !== "" && value !== null && value !== undefined,
      )
      .map(([key, value]) => [key, String(value)]),
  );
  return `${path}?${query}`;
}

export function PartSerializationPanel({
  item,
  location,
  companyId = "",
  actorId = "",
  onBack,
  onInventoryChanged,
}) {
  const rootRef = useRef(null);
  const backRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [quantityToCreate, setQuantityToCreate] = useState("1");
  const [intakeCondition, setIntakeCondition] = useState("new");
  const [conditionEvidence, setConditionEvidence] = useState("");
  const [intakeBinLocation, setIntakeBinLocation] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdBatch, setCreatedBatch] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [unitLoading, setUnitLoading] = useState(false);
  const [unitError, setUnitError] = useState("");
  const [custodyCondition, setCustodyCondition] = useState("");
  const [custodyCursor, setCustodyCursor] = useState([""]);
  const [custodyRefreshVersion, setCustodyRefreshVersion] = useState(0);
  const [custodyUnits, setCustodyUnits] = useState({
    items: [],
    nextCursor: null,
    loading: false,
    error: "",
  });
  const [custodyDetail, setCustodyDetail] = useState(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionBin, setCorrectionBin] = useState("");
  const [correctionEvidence, setCorrectionEvidence] = useState("");
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  const [pendingCorrection, setPendingCorrection] = useState(null);
  const [correctionRetryAllowed, setCorrectionRetryAllowed] = useState(false);
  const selectedUnitSource = serializedUnitSourceView(selectedUnit?.source);
  const selectedUnitUsesInternalTrackingId =
    selectedUnit?.source?.type === "legacy_tracking" ||
    /^LEGACY-/.test(selectedUnit?.serialNumber || "");

  const endpoint = `/api/office/inventory/parts/${encodeURIComponent(item.catalogPartId)}/locations/${encodeURIComponent(location.locationId)}/units`;
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api(endpoint));
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    setCreatedBatch(null);
    setConfirmed(false);
    setQuantityToCreate("1");
    setIntakeCondition("new");
    setConditionEvidence("");
    setIntakeBinLocation("");
    setCreateOpen(false);
    setSelectedUnitId("");
    setSelectedUnit(null);
    setUnitError("");
    setCustodyCondition("");
    setCustodyCursor([""]);
    setCustodyUnits({ items: [], nextCursor: null, loading: false, error: "" });
    setCustodyDetail(null);
    setCorrectionOpen(false);
    setCorrectionBin("");
    setCorrectionEvidence("");
    setCorrectionError("");
    load();
  }, [load]);

  useEffect(() => {
    if (!companyId || !location?.locationId || !item?.catalogPartId)
      return undefined;
    let active = true;
    setCustodyUnits((current) => ({ ...current, loading: true, error: "" }));
    api(
      reusePath(
        `/api/inventory-reuse/stock/${encodeURIComponent(item.catalogPartId)}/units`,
        {
          companyId,
          locationId: location.locationId,
          condition: custodyCondition,
          limit: 25,
          cursor: custodyCursor.at(-1),
        },
      ),
    )
      .then((result) => {
        if (active)
          setCustodyUnits({
            items: result.items || [],
            conditionCounts: result.conditionCounts || {},
            nextCursor: result.nextCursor || null,
            loading: false,
            error: "",
          });
      })
      .catch((nextError) => {
        if (active)
          setCustodyUnits((current) => ({
            ...current,
            loading: false,
            error:
              nextError.message || "Exact custody units could not be loaded.",
          }));
      });
    return () => {
      active = false;
    };
  }, [
    companyId,
    custodyCondition,
    custodyCursor,
    custodyRefreshVersion,
    item?.catalogPartId,
    location?.locationId,
  ]);

  useEffect(() => {
    if (!selectedUnitId) return undefined;
    let active = true;
    setUnitLoading(true);
    setUnitError("");
    api(`/api/office/inventory/units/${encodeURIComponent(selectedUnitId)}`)
      .then((result) => {
        if (active) setSelectedUnit(result);
      })
      .catch((nextError) => {
        if (active) setUnitError(nextError.message);
      })
      .finally(() => {
        if (active) setUnitLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedUnitId]);

  useEffect(() => {
    if (!selectedUnitId || !companyId || !location?.locationId)
      return undefined;
    let active = true;
    setCustodyDetail(null);
    api(
      reusePath(
        `/api/inventory-reuse/units/${encodeURIComponent(selectedUnitId)}`,
        { companyId, locationId: location.locationId },
      ),
    )
      .then((result) => {
        if (active) setCustodyDetail(result);
      })
      .catch(() => {
        if (active) setCustodyDetail(null);
      });
    return () => {
      active = false;
    };
  }, [companyId, location?.locationId, selectedUnitId]);

  useEffect(() => {
    if (!selectedUnitId || !actorId || !companyId || !location?.locationId)
      return;
    try {
      setPendingCorrection(
        JSON.parse(
          window.sessionStorage.getItem(
            `inventory-bin-correction:${actorId}:${companyId}:${location.locationId}:${selectedUnitId}`,
          ) || "null",
        ),
      );
      setCorrectionRetryAllowed(false);
    } catch {
      setPendingCorrection(null);
      setCorrectionRetryAllowed(false);
    }
  }, [actorId, companyId, location?.locationId, selectedUnitId]);

  useEffect(() => {
    if (selectedUnitId) backRef.current?.focus();
  }, [selectedUnitId]);

  function returnToUnits() {
    const unitId = selectedUnitId;
    setSelectedUnitId("");
    setSelectedUnit(null);
    setCustodyDetail(null);
    setUnitError("");
    window.requestAnimationFrame(() =>
      rootRef.current?.querySelector(`[data-unit-id="${unitId}"]`)?.focus(),
    );
  }

  async function correctBin() {
    const unit = custodyDetail?.unit;
    if (
      !unit ||
      !actorId ||
      !companyId ||
      !location?.locationId ||
      correctionSaving ||
      (!pendingCorrection && !correctionEvidence.trim())
    )
      return;
    const recoveryKey = `inventory-bin-correction:${actorId}:${companyId}:${location.locationId}:${unit.id}`;
    if (pendingCorrection && !correctionRetryAllowed) {
      setCorrectionError("Check the saved correction before retrying.");
      return;
    }
    const request = pendingCorrection || {
      path: "/api/inventory-reuse/location-correction",
      body: {
        companyId,
        locationId: location.locationId,
        unitId: unit.id,
        custodyVersion: unit.custodyVersion,
        holderType: "inventory_location",
        binLocation: correctionBin.trim(),
        externalReference: unit.custodyExternalReference || "",
        evidence: correctionEvidence.trim(),
        idempotencyKey: crypto.randomUUID(),
      },
    };
    if (!pendingCorrection) {
      try {
        window.sessionStorage.setItem(recoveryKey, JSON.stringify(request));
        setPendingCorrection(request);
      } catch {
        setCorrectionError(
          "This correction cannot be saved until session storage is available.",
        );
        return;
      }
    }
    setCorrectionSaving(true);
    setCorrectionError("");
    setCorrectionRetryAllowed(false);
    try {
      await api(request.path, {
        method: "POST",
        body: JSON.stringify(request.body),
      });
      window.sessionStorage.removeItem(recoveryKey);
      setPendingCorrection(null);
      setCorrectionRetryAllowed(false);
      const refreshed = await api(
        reusePath(`/api/inventory-reuse/units/${encodeURIComponent(unit.id)}`, {
          companyId,
          locationId: location.locationId,
        }),
      );
      setCustodyDetail(refreshed);
      setCorrectionOpen(false);
      setCorrectionEvidence("");
    } catch (error) {
      if (error.status === 409) {
        window.sessionStorage.removeItem(recoveryKey);
        setPendingCorrection(null);
        setCorrectionRetryAllowed(false);
      }
      setCorrectionError(
        !error.status || error.status >= 500
          ? `${error.message || "The outcome is unknown."} Check the saved correction before retrying.`
          : error.message || "The bin correction could not be saved.",
      );
    } finally {
      setCorrectionSaving(false);
    }
  }
  async function checkCorrection() {
    const unit = custodyDetail?.unit;
    const key = `inventory-bin-correction:${actorId}:${companyId}:${location.locationId}:${unit?.id}`;
    try {
      const request = JSON.parse(window.sessionStorage.getItem(key) || "null");
      if (!request?.body?.idempotencyKey) return;
      await api(
        reusePath(
          `/api/inventory-reuse/operations/${encodeURIComponent(request.body.idempotencyKey)}`,
          { companyId, locationId: location.locationId },
        ),
      );
      window.sessionStorage.removeItem(key);
      setPendingCorrection(null);
      setCorrectionRetryAllowed(false);
      const refreshed = await api(
        reusePath(`/api/inventory-reuse/units/${encodeURIComponent(unit.id)}`, {
          companyId,
          locationId: location.locationId,
        }),
      );
      setCustodyDetail(refreshed);
      setCorrectionOpen(false);
      setCorrectionError("");
    } catch (error) {
      if (error.code === "INVENTORY_REUSE_OPERATION_NOT_FOUND") {
        setCorrectionRetryAllowed(true);
        setCorrectionError(
          "No committed correction was found. Retry the saved correction.",
        );
        return;
      }
      setCorrectionError(
        error.message || "The saved correction is not yet confirmed.",
      );
    }
  }

  async function createUnits(event) {
    event.preventDefault();
    const parsedQuantity = Number(quantityToCreate);
    if (
      !Number.isInteger(parsedQuantity) ||
      parsedQuantity < 1 ||
      parsedQuantity > 500
    ) {
      setError("Enter a whole quantity from 1 to 500.");
      return;
    }
    if (!confirmed) {
      setError(
        "Confirm that these physical units are present at this location.",
      );
      return;
    }
    setCreating(true);
    setError("");
    try {
      const result = await api(endpoint, {
        method: "POST",
        body: JSON.stringify({
          quantity: parsedQuantity,
          confirmation: "physically_present_at_location",
          conditionCode: intakeCondition,
          conditionEvidence: conditionEvidence.trim(),
          binLocation: intakeBinLocation.trim(),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setCreatedBatch(result.batch);
      setConfirmed(false);
      setQuantityToCreate("1");
      setCreateOpen(false);
      await load();
      setCustodyRefreshVersion((version) => version + 1);
      onInventoryChanged?.();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="inventory-serial-drilldown" ref={rootRef}>
      <button
        className="inventory-detail-back"
        ref={backRef}
        type="button"
        onClick={selectedUnitId ? returnToUnits : onBack}
      >
        <ArrowLeft />
        {selectedUnitId ? "Serialized units" : "All locations"}
      </button>

      {loading ? (
        <div className="inventory-serial-loading">
          <RefreshCw01 className="loading-icon" />
          Loading serialized units
        </div>
      ) : null}
      {error ? (
        <p className="ops-error" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && data && selectedUnitId ? (
        <div className="inventory-unit-detail">
          {unitLoading ? (
            <div className="inventory-serial-loading">
              <RefreshCw01 className="loading-icon" />
              Loading unit history
            </div>
          ) : null}
          {unitError ? (
            <p className="ops-error" role="alert">
              {unitError}
            </p>
          ) : null}
          {!unitLoading && selectedUnit ? (
            <>
              <header className="inventory-unit-header">
                <div>
                  <span>
                    {selectedUnitUsesInternalTrackingId
                      ? "Internal tracking ID"
                      : "Serialized unit"}
                  </span>
                  <code>{selectedUnit.serialNumber}</code>
                </div>
                <span
                  className={`inventory-unit-status is-${selectedUnit.status}`}
                >
                  {unitStatus(selectedUnit.status)}
                </span>
              </header>
              <div className="inventory-unit-actions">
                <a
                  className="button primary"
                  href={selectedUnit.printUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Printer />
                  Print QR
                </a>
                {selectedUnit.labelBatch?.status === "ready" ? (
                  <a
                    className="button secondary"
                    href={selectedUnit.labelBatch.printUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Printer />
                    Print batch · {selectedUnit.labelBatch.itemCount}
                  </a>
                ) : null}
              </div>
              <dl className="inventory-unit-facts">
                <div>
                  <dt>Location</dt>
                  <dd>{selectedUnit.locationName}</dd>
                </div>
                <div>
                  <dt>Where it is</dt>
                  <dd>{custodyHolder(custodyDetail?.unit || selectedUnit)}</dd>
                </div>
                <div>
                  <dt>Condition</dt>
                  <dd>
                    {CONDITION_LABELS[
                      custodyDetail?.unit?.conditionCode ||
                        selectedUnit.conditionCode
                    ] || "Not classified"}
                  </dd>
                </div>
                <div>
                  <dt>Availability</dt>
                  <dd>
                    {isAvailableForUse(custodyDetail?.unit || selectedUnit)
                      ? "Available"
                      : "Not available"}
                  </dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>
                    {selectedUnitSource.label}
                    {selectedUnitSource.href ? (
                      <>
                        {" "}
                        ·{" "}
                        <a
                          href={selectedUnitSource.href}
                          aria-label={`Open invoice ${selectedUnitSource.details}`}
                        >
                          {selectedUnitSource.details}
                        </a>
                      </>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>
                    {dateTime(selectedUnit.createdAt)}
                    {selectedUnit.createdBy?.name
                      ? ` by ${selectedUnit.createdBy.name}`
                      : ""}
                  </dd>
                </div>
                {selectedUnit.providerLotExternalId ? (
                  <div>
                    <dt>Provider serial</dt>
                    <dd>{selectedUnit.providerLotExternalId}</dd>
                  </div>
                ) : null}
              </dl>
              {custodyDetail?.capabilities?.route &&
              custodyDetail?.unit?.status === "in_stock" &&
              custodyDetail?.unit?.custodyHolderType ===
                "inventory_location" ? (
                <section
                  className="inventory-unit-timeline"
                  aria-labelledby="inventory-unit-holder-title"
                >
                  <h4 id="inventory-unit-holder-title">Correct bin or shelf</h4>
                  {!correctionOpen ? (
                    <Button
                      type="button"
                      onClick={() => {
                        setCorrectionBin(
                          custodyDetail.unit.custodyBinLocation || "",
                        );
                        setCorrectionOpen(true);
                      }}
                    >
                      Correct holder
                    </Button>
                  ) : (
                    <>
                      <p>
                        This records only the physical bin or shelf. It does not
                        transfer the warehouse or change stock.
                      </p>
                      <label>
                        Bin or shelf
                        <input
                          value={correctionBin}
                          onChange={(event) =>
                            setCorrectionBin(event.target.value)
                          }
                          disabled={correctionSaving || Boolean(pendingCorrection)}
                        />
                      </label>
                      <label>
                        Correction evidence
                        <textarea
                          rows="2"
                          value={correctionEvidence}
                          onChange={(event) =>
                            setCorrectionEvidence(event.target.value)
                          }
                          disabled={correctionSaving || Boolean(pendingCorrection)}
                        />
                      </label>
                      {correctionError ? (
                        <div className="ops-error" role="alert">
                          <p>{correctionError}</p>
                          {pendingCorrection ? (
                            <Button
                              type="button"
                              disabled={correctionSaving}
                              onClick={checkCorrection}
                            >
                              Check saved correction
                            </Button>
                          ) : null}
                          {pendingCorrection && correctionRetryAllowed ? (
                            <Button
                              type="button"
                              variant="primary"
                              disabled={correctionSaving}
                              onClick={correctBin}
                            >
                              Retry saved correction
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                      <div>
                        <Button
                          type="button"
                          variant="primary"
                          disabled={
                            correctionSaving ||
                            Boolean(pendingCorrection) ||
                            !correctionEvidence.trim()
                          }
                          onClick={correctBin}
                        >
                          {correctionSaving ? "Saving…" : "Save correction"}
                        </Button>
                        <Button
                          type="button"
                          disabled={correctionSaving || Boolean(pendingCorrection)}
                          onClick={() => setCorrectionOpen(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </>
                  )}
                </section>
              ) : null}
              <section
                className="inventory-unit-timeline"
                aria-labelledby="inventory-unit-timeline-title"
              >
                <h4 id="inventory-unit-timeline-title">Timeline</h4>
                {selectedUnit.events?.length ? (
                  <ol>
                    {selectedUnit.events.map((event) => (
                      <li key={event.id || `${event.type}-${event.at}`}>
                        <span aria-hidden="true" />
                        <div>
                          <strong>{eventLabel(event.type)}</strong>
                          <small>
                            {dateTime(event.at)}
                            {event.actor?.name ? ` · ${event.actor.name}` : ""}
                          </small>
                          {eventContext(event) ? (
                            <p>{eventContext(event)}</p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>No recorded activity yet.</p>
                )}
              </section>
              {custodyDetail?.unit?.timeline?.length ? (
                <section
                  className="inventory-unit-timeline"
                  aria-labelledby="inventory-unit-custody-history-title"
                >
                  <h4 id="inventory-unit-custody-history-title">
                    Custody history
                  </h4>
                  <ol>
                    {custodyDetail.unit.timeline.map((event, index) => (
                      <li
                        key={
                          event.id || `${event.eventType}-${event.at}-${index}`
                        }
                      >
                        <span aria-hidden="true" />
                        <div>
                          <strong>
                            {event.eventType
                              ? eventLabel(event.eventType)
                              : "Updated"}
                          </strong>
                          <small>{dateTime(event.at)}</small>
                          {custodyEventContext(event) ? (
                            <p>{custodyEventContext(event)}</p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      ) : !loading && data ? (
        <>
          <div className="inventory-location-overview">
            <div className="inventory-location-overview-heading">
              <strong>{location.locationName}</strong>
              <span>
                {data.units.length} serialized unit
                {data.units.length === 1 ? "" : "s"}
              </span>
            </div>
            <dl>
              <div>
                <dt>Our stock</dt>
                <dd>
                  {quantity(data.location.localQuantityOnHand)}{" "}
                  {data.part.uomCode}
                </dd>
              </div>
              <div>
                <dt>Available</dt>
                <dd>
                  {quantity(
                    Math.max(
                      data.location.localQuantityOnHand -
                        data.location.localQuantityReserved,
                      0,
                    ),
                  )}{" "}
                  {data.part.uomCode}
                </dd>
              </div>
              <div>
                <dt>Odoo · read-only</dt>
                <dd>
                  {quantity(data.location.odooQuantityOnHand)}{" "}
                  {data.part.uomCode}
                </dd>
              </div>
            </dl>
          </div>

          <div className="inventory-serial-toolbar">
            <strong>Serialized units</strong>
            <div className="inventory-serial-actions">
              {data.printUrl ? (
                <a
                  className="button secondary"
                  href={data.printUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Printer />
                  <span>
                    {data.truncated ? "Print first 500" : "Print all"}
                  </span>
                </a>
              ) : null}
              {data.units.length > 0 &&
              data.canCreateAtLocation &&
              data.canCreateSerializedUnits &&
              !createOpen ? (
                <Button
                  type="button"
                  icon={Plus}
                  onClick={() => setCreateOpen(true)}
                >
                  Add units
                </Button>
              ) : null}
              {createdBatch ? (
                <a
                  className="inventory-created-labels"
                  href={createdBatch.printUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Printer />
                  Print new batch · {createdBatch.itemCount}
                </a>
              ) : null}
            </div>
          </div>

          {companyId ? (
            <section
              className="inventory-custody-exact"
              aria-labelledby="inventory-custody-exact-title"
            >
              <div className="inventory-serial-toolbar">
                <strong id="inventory-custody-exact-title">
                  Condition and exact custody
                </strong>
                <label>
                  <span className="inventory-count-visually-hidden">
                    Condition
                  </span>
                  <Dropdown
                    value={custodyCondition}
                    onChange={(event) => {
                      setCustodyCondition(event.target.value);
                      setCustodyCursor([""]);
                    }}
                    aria-label="Filter exact units by condition"
                  >
                    <option value="">All conditions</option>
                    {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </Dropdown>
                </label>
              </div>
              <div className="inventory-detail-metrics" aria-live="polite">
                {[["new", "New available"], ["reusable", "Reusable available"], ["refurbished", "Refurbished available"]].map(([value, label]) => (
                  <div key={value}>
                    <span>{label}</span>
                    <strong>
                      {custodyUnits.conditionCounts?.[value] ?? 0}
                    </strong>
                  </div>
                ))}
              </div>
              <p className="inventory-serial-note">
                Condition totals are scoped to this part and location. Use the
                filter to inspect exact units without changing inventory
                quantities.
              </p>
              {custodyUnits.error ? (
                <p className="ops-error" role="alert">
                  {custodyUnits.error}
                </p>
              ) : null}
              {custodyUnits.loading ? (
                <p role="status">Loading exact custody units…</p>
              ) : custodyUnits.items.length ? (
                <ul
                  className="inventory-serial-list"
                  aria-label="Exact custody units"
                >
                  {custodyUnits.items.map((unit) => (
                    <li key={unit.id}>
                      <button
                        type="button"
                        className="inventory-serial-unit-open"
                        data-unit-id={unit.id}
                        onClick={() => setSelectedUnitId(unit.id)}
                      >
                        <span>
                          <code>{unit.serialNumber}</code>
                          <small>
                            {[
                              CONDITION_LABELS[unit.conditionCode] ||
                                "Not classified",
                              custodyHolder(unit),
                              isAvailableForUse(unit)
                                ? "Available"
                                : "Not available",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </span>
                        <ChevronRight aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No exact units match this condition.</p>
              )}
              <Pagination
                currentPage={custodyCursor.length}
                pageCount={
                  custodyUnits.nextCursor
                    ? custodyCursor.length + 1
                    : custodyCursor.length
                }
                setPage={(next) => {
                  if (next < custodyCursor.length)
                    setCustodyCursor((current) => current.slice(0, next));
                  else if (custodyUnits.nextCursor)
                    setCustodyCursor((current) => [
                      ...current,
                      custodyUnits.nextCursor,
                    ]);
                }}
                total={0}
                label="exact units"
                loading={custodyUnits.loading}
              />
            </section>
          ) : null}

          {data.units.length ? (
            <div
              className="inventory-serial-list"
              aria-label={`Serialized units at ${location.locationName}`}
            >
              {data.units.map((unit) => (
                <article key={unit.id}>
                  <button
                    type="button"
                    className="inventory-serial-unit-open"
                    data-unit-id={unit.id}
                    onClick={() => setSelectedUnitId(unit.id)}
                    aria-label={`View ${unit.serialNumber}`}
                  >
                    <span>
                      <code>{unit.serialNumber}</code>
                      <small>
                        {[
                          unitStatus(unit.status),
                          unit.conditionCode
                            ? {
                                new: "New",
                                serviceable_used: "Reusable",
                                refurbished: "Refurbished",
                                unknown: "Not classified",
                              }[unit.conditionCode] || unit.conditionCode
                            : "",
                          custodyHolder(unit),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                  <a
                    href={unit.printUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Print QR label for ${unit.serialNumber}`}
                  >
                    <Printer />
                    Print QR
                  </a>
                </article>
              ))}
              {data.truncated ? (
                <p>Showing the first 500 serialized units.</p>
              ) : null}
            </div>
          ) : (
            <div className="inventory-serial-empty">
              <QrCode01 />
              <strong>No serialized children yet</strong>
              <p>Add the physical units currently at this location.</p>
              {data.canCreateAtLocation &&
              data.canCreateSerializedUnits &&
              !createOpen ? (
                <Button
                  type="button"
                  variant="primary"
                  icon={Plus}
                  onClick={() => setCreateOpen(true)}
                >
                  Add units
                </Button>
              ) : null}
            </div>
          )}

          {data.canCreateAtLocation &&
          data.canCreateSerializedUnits &&
          createOpen ? (
            <form className="inventory-serial-create" onSubmit={createUnits}>
              <div className="inventory-serial-create-heading">
                <div>
                  <strong>Add units</strong>
                  <p>One serial number and QR label per unit.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  aria-label="Close add units"
                >
                  <XClose />
                </button>
              </div>
              <label>
                <span>Quantity</span>
                <input
                  autoFocus
                  type="number"
                  min="1"
                  max="500"
                  step="1"
                  value={quantityToCreate}
                  onChange={(event) => setQuantityToCreate(event.target.value)}
                  disabled={creating}
                />
              </label>
              <label>
                <span>Condition</span>
                <Dropdown
                  value={intakeCondition}
                  onChange={(event) => setIntakeCondition(event.target.value)}
                  disabled={creating}
                >
                  <option value="new">New</option>
                  <option value="serviceable_used">Reusable used</option>
                  <option value="refurbished">Refurbished</option>
                </Dropdown>
              </label>
              <label>
                <span>Condition evidence (required)</span>
                <textarea
                  rows="2"
                  value={conditionEvidence}
                  onChange={(event) => setConditionEvidence(event.target.value)}
                  placeholder="Inspection, supplier statement, or refurbishment record"
                  disabled={creating}
                />
              </label>
              <label>
                <span>Bin or shelf (optional)</span>
                <input
                  value={intakeBinLocation}
                  onChange={(event) => setIntakeBinLocation(event.target.value)}
                  disabled={creating}
                />
              </label>
              <label className="inventory-serial-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  disabled={creating}
                />
                <span>
                  I confirm these units are physically present at{" "}
                  {location.locationName}.
                </span>
              </label>
              <Button
                type="submit"
                variant="primary"
                icon={Plus}
                disabled={creating || !confirmed || !conditionEvidence.trim()}
              >
                {creating
                  ? "Adding units…"
                  : `Add ${quantityToCreate || 0} unit${Number(quantityToCreate) === 1 ? "" : "s"}`}
              </Button>
            </form>
          ) : !data.canCreateAtLocation ? (
            <p className="inventory-serial-note">
              An assigned Office user or Admin can add units here.
            </p>
          ) : !data.canCreateSerializedUnits ? (
            <p className="inventory-serial-note">
              This unit cannot be serialized individually.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
