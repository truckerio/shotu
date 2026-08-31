import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, SearchMd } from "@untitledui/icons";
import { api } from "../../lib/api.js";
import { QuantityUnitInput } from "../forms/QuantityUnitInput.jsx";
import { NarrativeField } from "../forms/NarrativeField.jsx";
import { formatQuantityUnit } from "../forms/quantity-unit-model.js";
import { Button } from "../ui/Button.jsx";
import {
  MAX_USED_PARTS,
  addUsedPart,
  defaultUsedPartQuantity,
  initialUsedPartRows,
  normalizeUsedParts,
  readonlyUsedParts,
  removeUsedPart,
  serializedUsageTableState,
  usedPartQuantityAfterPartNumberChange,
} from "./used-parts-model.js";
import { createSerializedRepairAutosave } from "./serialized-repair-autosave.js";
import {
  mechanicWorkStorageKey,
  removeLegacyMechanicWorkStorage,
} from "../../features/mechanic/progress/mechanic-work-storage.js";
import "./used-parts-editor.css";
import { PartCatalogCombobox } from "./part-requests/PartCatalogCombobox.jsx";
import { WorkorderSerializedPartDialog } from "./part-requests/WorkorderSerializedPartDialog.jsx";
import { AggregatePartUsageRows, MeasuredPartUsageDialog } from "./part-requests/MeasuredPartUsageDialog.jsx";
import { RepairHistorySuggestions } from "./part-requests/RepairHistorySuggestions.jsx";
import { laborProductLabel } from "../../../../shared/labor-product.js";
import { interfaceText } from "../../i18n/index.js";
import { getUnitDefinition } from "../../../../shared/units-of-measure.js";

const MEASURED_UOM_CATEGORIES = new Set(["liquid_volume", "mass", "gas_volume", "length"]);

function vehicleInput(detail) {
  const asset = detail.workorder.asset || {};
  return {
    assetId: asset.id || detail.workorder.assetId || undefined,
    unitNo: asset.unitNo || asset.name || "",
    vin: asset.vin || detail.workorder.formData?.vinNo || "",
    make: asset.make || "",
    model: asset.model || detail.workorder.formData?.model || "",
    year: asset.year || undefined,
    engine: detail.workorder.formData?.engine || "",
  };
}

function purchasingLocation(detail) {
  const name = detail.workorder.location?.name || "Chino";
  return {
    country: "US",
    city: name.replace(/\s+yard$/i, "") || "Chino",
    region: "CA",
    timezone: "America/Los_Angeles",
  };
}

function looksLikePartNumber(value) {
  const text = String(value || "").trim();
  return text.length >= 3 && /\d/.test(text) && !/\s/.test(text) && /^[a-z0-9._/-]+$/i.test(text);
}

function partFingerprint(part) {
  return [part?.partNo || "", part?.qty || "", part?.uomCode || "", part?.repairOrder || ""].join("\u001f");
}

export function UsedPartsEditor({
  actorId,
  role = "read",
  detail,
  parts,
  laborHours = "",
  laborProduct = null,
  laborRepairOrder = "",
  laborRepairOrderDisabled = false,
  installedParts = [],
  onLaborHoursChange = () => {},
  onLaborRepairOrderChange = () => {},
  onChange,
  onSave,
  onChanged = () => {},
  onRegisterSerializedRepairFlush = () => {},
  serializedParts = null,
  disabled = false,
  partsEditable = !disabled,
  laborEditable = !disabled,
  defaultRows,
  suggestionsEnabled = true,
  locale = "en",
  readonlyMessage = "Used parts are read-only for your role.",
}) {
  const t = (key) => interfaceText(locale, key);
  const readOnlyText = locale === "en" ? readonlyMessage : t("parts.usedPartsReadOnly");
  const [visibleRowCount, setVisibleRowCount] = useState(() => initialUsedPartRows(parts, defaultRows).length);
  const rows = useMemo(
    () => normalizeUsedParts(parts, visibleRowCount),
    [parts, visibleRowCount],
  );
  const savePayload = useMemo(
    () => JSON.stringify({ parts: rows }),
    [rows],
  );
  const storageKey = actorId
    ? mechanicWorkStorageKey("used-parts", actorId, detail.workorder.id)
    : "";
  const persistedRef = useRef(savePayload);
  const hydratedRef = useRef(false);
  const saveRef = useRef(onSave);
  const [findingRow, setFindingRow] = useState(-1);
  const [saveState, setSaveState] = useState("");
  const [message, setMessage] = useState("");
  const [selectedCatalogParts, setSelectedCatalogParts] = useState([]);
  const [serializedDialogPart, setSerializedDialogPart] = useState(null);
  const [measuredDialogPart, setMeasuredDialogPart] = useState(null);
  const serializedDialogOriginRef = useRef(-1);
  const measuredDialogOriginRef = useRef(-1);
  const legacyManualRowsRef = useRef(new Set(normalizeUsedParts(parts)
    .filter((part) => part.partNo || part.qty || part.repairOrder)
    .map(partFingerprint)));
  const [serializedRepairOrders, setSerializedRepairOrders] = useState({});
  const [savingSerializedUsageId, setSavingSerializedUsageId] = useState("");
  const focusedSerializedUsageId = serializedParts?.focusUsageId || "";
  const serializedRepairContextRef = useRef(null);
  const serializedRepairAutosaveRef = useRef(null);
  serializedRepairContextRef.current = { detail, locale, onChanged };
  if (!serializedRepairAutosaveRef.current) {
    serializedRepairAutosaveRef.current = createSerializedRepairAutosave({
      save: async (part, repairOrder) => {
        const context = serializedRepairContextRef.current;
        await api(`/api/workorders/${encodeURIComponent(context.detail.workorder.id)}/modules/parts/actions/record`, {
          method: "POST",
          body: JSON.stringify({
            operation: "serializedUsageRepairOrder",
            usageId: part.usageId,
            repairOrder,
          }),
        });
        await context.onChanged();
      },
      onSaving: (usageId, saving) => setSavingSerializedUsageId((current) => (
        saving ? usageId : current === usageId ? "" : current
      )),
      onSaved: (usageId, repairOrder) => setSerializedRepairOrders((current) => {
        if (current[usageId] !== repairOrder) return current;
        const next = { ...current };
        delete next[usageId];
        return next;
      }),
      onError: (error) => {
        const context = serializedRepairContextRef.current;
        setMessage(context.locale === "en" && error?.message
          ? error.message
          : interfaceText(context.locale, "parts.saveFailed"));
      },
    });
  }
  const serializedRepairAutosave = serializedRepairAutosaveRef.current;

  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    if (!focusedSerializedUsageId) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const row = document.getElementById(`serialized-part-${focusedSerializedUsageId}`);
      row?.scrollIntoView?.({ block: "nearest" });
      row?.focus?.({ preventScroll: true });
      serializedParts?.onUsageFocused?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedSerializedUsageId, serializedParts]);

  useEffect(() => {
    onRegisterSerializedRepairFlush(serializedRepairAutosave.flushAll);
    return () => {
      onRegisterSerializedRepairFlush(null);
      serializedRepairAutosave.dispose();
    };
  }, [onRegisterSerializedRepairFlush, serializedRepairAutosave]);

  useEffect(() => {
    const currentRows = initialUsedPartRows(parts, defaultRows);
    setVisibleRowCount(currentRows.length);
    hydratedRef.current = false;
    persistedRef.current = JSON.stringify({ parts: currentRows });
    setSaveState("");
    setMessage("");
    setSelectedCatalogParts([]);
    setSerializedDialogPart(null);
    setMeasuredDialogPart(null);

    hydratedRef.current = true;
    removeLegacyMechanicWorkStorage();
    if (!storageKey || !partsEditable) return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) return;
      const storedValue = JSON.parse(stored);
      const recovered = initialUsedPartRows(Array.isArray(storedValue) ? storedValue : storedValue.parts, defaultRows);
      setVisibleRowCount(recovered.length);
      if (JSON.stringify(recovered) !== JSON.stringify(currentRows)) {
        onChange(recovered);
        setMessage(t("parts.recoveredUnsavedEntries"));
      }
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, [partsEditable, storageKey]);

  useEffect(() => {
    legacyManualRowsRef.current = new Set(normalizeUsedParts(parts)
      .filter((part) => part.partNo || part.qty || part.repairOrder)
      .map(partFingerprint));
  }, [detail.workorder.id]);

  useEffect(() => {
    if (!hydratedRef.current || !partsEditable || !storageKey) return undefined;
    if (savePayload === persistedRef.current) return undefined;
    window.localStorage.setItem(storageKey, savePayload);
    setSaveState(t("progress.saving"));
    const timer = window.setTimeout(async () => {
      try {
        await saveRef.current(rows);
        persistedRef.current = savePayload;
        window.localStorage.removeItem(storageKey);
        setSaveState(t("progress.saved"));
      } catch (error) {
        setSaveState(t("progress.notSaved"));
        setMessage(locale === "en" && error?.message ? error.message : t("parts.saveFailed"));
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [partsEditable, rows, savePayload, storageKey]);

  function update(index, field, value) {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  function updateFields(index, fields) {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...fields } : row));
  }

  function addRow() {
    const next = addUsedPart(rows, rows.length);
    setVisibleRowCount(next.length);
    onChange(next);
  }

  function removeRow(index) {
    const normalized = removeUsedPart(rows, index, Math.max(0, rows.length - 1));
    setVisibleRowCount(normalized.length);
    setSelectedCatalogParts((current) => current.filter((_, rowIndex) => rowIndex !== index));
    onChange(normalized);
  }

  function setSelectedCatalogPart(index, part) {
    setSelectedCatalogParts((current) => {
      const next = [...current];
      next[index] = part;
      return next;
    });
  }

  function serializedRepairOrder(part) {
    return Object.hasOwn(serializedRepairOrders, part.usageId)
      ? serializedRepairOrders[part.usageId]
      : part.repairOrder;
  }

  function updateSerializedRepairOrder(part, repairOrder) {
    if (!part.usageId) return;
    setSerializedRepairOrders((current) => ({ ...current, [part.usageId]: repairOrder }));
    setMessage("");
    serializedRepairAutosave.update(part, repairOrder);
  }

  async function suggestRepair(index) {
    const row = rows[index];
    if (!looksLikePartNumber(row.partNo)) return;
    setFindingRow(index);
    setMessage("");
    try {
      const result = await api("/api/parts-helper/identify", {
        method: "POST",
        body: JSON.stringify({
          query: row.partNo,
          vehicle: vehicleInput(detail),
          location: purchasingLocation(detail),
        }),
      });
      const next = [...rows];
      next[index] = {
        ...row,
        partNo: result.part.normalizedPartNumber || row.partNo,
        qty: defaultUsedPartQuantity(result.part.suggestedQuantity || row.qty),
        uomCode: result.part.uomCode || row.uomCode,
      };
      onChange(next);
      setMessage(t("parts.detailsFound"));
    } catch {
      setMessage(t("parts.detailsUnavailable"));
    } finally {
      setFindingRow(-1);
    }
  }

  const serializedUsageState = serializedParts?.usageSnapshotReady
    ? serializedUsageTableState(serializedParts.usages, serializedParts.actionsFor)
    : { active: installedParts.map((part) => ({ ...part, status: "installed" })), completed: [] };
  const activeSerializedParts = serializedUsageState.active;
  const completedSerializedUsages = serializedUsageState.completed;
  const aggregatePartUsages = detail?.modules?.parts?.data?.aggregatePartUsages || detail?.aggregatePartUsages || [];

  function renderSerializedPartRow(part, index) {
    const usage = part.usage;
    const actions = usage && serializedParts ? serializedParts.actionsFor(usage) : {};
    const installed = ["installed_pending_approval", "installed"].includes(part.status);
    const status = usage && serializedParts ? serializedParts.statusLabel(usage.status) : t("parts.installed");
    const confirmingRemoval = usage && serializedParts?.removeConfirmationId === usage.id;
    const removing = usage && serializedParts?.busy === `${usage.id}:remove`;
    const rowBusy = Boolean(serializedParts?.busy);
    const rowId = usage?.id ? `serialized-part-${usage.id}` : undefined;
    return (
      <div className="used-part-serialized-group" key={`serialized-${part.usageId || part.catalogPartId || part.partNo}-${index}`}>
        <div
          id={rowId}
          className="part-row used-part-serialized-row"
          tabIndex={rowId ? -1 : undefined}
          aria-label={`${part.partNo}, ${formatQuantityUnit(part.qty, part.uomCode)}, ${status}`}
        >
          <strong>{index + 2}</strong>
          <div className="used-part-field used-part-serialized-identity">
            <strong>{part.partNo}</strong>
            {part.serialNumber ? <small className="used-part-serialized-serial">{part.serialNumber}</small> : null}
            <small className="used-part-serialized-kind">{t("parts.serialized")}</small>
          </div>
          <div className="used-part-field used-part-serialized-value">
            <strong>{formatQuantityUnit(part.qty, part.uomCode)}</strong>
          </div>
          <div className="used-part-field used-part-repair">
            {installed ? (
              <>
                <NarrativeField
                  locale={locale}
                  singleLine
                  value={serializedRepairOrder(part)}
                  onChange={(event) => updateSerializedRepairOrder(part, event.target.value)}
                  onBlur={() => serializedRepairAutosave.flushOne(part)}
                  aria-label={`${t("parts.repairOrder")} ${index + 2}`}
                  placeholder={t("parts.describeRepair")}
                  disabled={disabled || !part.usageId}
                />
                {suggestionsEnabled && part.catalogPartId && part.usageId ? <RepairHistorySuggestions
                  workorderId={detail.workorder.id}
                  catalogPartId={part.catalogPartId}
                  partNumber={part.partNo}
                  assetId={detail.workorder.asset?.id || detail.workorder.assetId}
                  onApply={(text) => updateSerializedRepairOrder(part, text)}
                  disabled={disabled || !part.usageId || savingSerializedUsageId === part.usageId}
                  locale={locale}
                /> : null}
              </>
            ) : <span className="used-part-pending-repair">{t("parts.repairAfterInstalled")}</span>}
          </div>
          <div className="used-part-serialized-actions">
            <span className="used-part-serialized-status">
              {savingSerializedUsageId === part.usageId ? t("progress.saving") : status}
            </span>
            {actions.install ? <Button type="button" variant="primary" onClick={() => serializedParts.finalize(usage, "installed")} disabled={rowBusy}>
              {t("parts.markInstalled")}
            </Button> : null}
            {actions.returnUnused ? <Button type="button" onClick={() => serializedParts.finalize(usage, "returned")} disabled={rowBusy}>
              {t("parts.returnUnused")}
            </Button> : null}
            {actions.remove && !confirmingRemoval ? <Button type="button" onClick={() => serializedParts.requestRemove(usage.id)} disabled={rowBusy}>
              {t("parts.removeFromUnit")}
            </Button> : null}
          </div>
        </div>
        {actions.remove && confirmingRemoval ? (
          <div className="used-part-serialized-confirmation" role="status" aria-live="polite">
            <p>{usage.status === "installed_pending_approval" ? t("parts.removePhysicalReturnConfirm") : t("parts.removeInspectionConfirm")}</p>
            <div>
              <Button type="button" variant="primary" onClick={() => serializedParts.removeFromUnit(usage)} disabled={rowBusy}>
                {removing ? t("parts.removing") : t("parts.confirmRemove")}
              </Button>
              <Button type="button" onClick={serializedParts.cancelRemove} disabled={rowBusy}>
                {t("parts.cancelRemove")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  const serializedToolbar = serializedParts?.scanControl ? (
    <div className="used-parts-toolbar">{serializedParts.scanControl}</div>
  ) : null;
  const serializedFeedback = serializedParts?.message ? (
    <p
      className="used-parts-serialized-feedback"
      role={serializedParts.messageTone === "error" ? "alert" : "status"}
      aria-live={serializedParts.messageTone === "error" ? "assertive" : "polite"}
    >
      {serializedParts.message}
    </p>
  ) : null;
  const serializedHistory = completedSerializedUsages.length ? (
    <details className="used-parts-serialized-history">
      <summary>{t("parts.previousScannedParts")} ({completedSerializedUsages.length})</summary>
      <ol aria-label={t("parts.completedSerializedHistory")}>
        {completedSerializedUsages.map((usage) => (
          <li key={usage.id}>
            <span><strong>{usage.partNumber}</strong><code>{usage.serialNumber}</code></span>
            <small>{serializedParts.statusLabel(usage.status)}</small>
          </li>
        ))}
      </ol>
    </details>
  ) : null;

  function closeSerializedDialog() {
    const origin = serializedDialogOriginRef.current;
    setSerializedDialogPart(null);
    window.requestAnimationFrame(() => document.querySelector(`[aria-label="${t("parts.partNumber")} ${origin + 1}"]`)?.focus());
  }

  function closeMeasuredDialog() {
    const origin = measuredDialogOriginRef.current;
    setMeasuredDialogPart(null);
    window.requestAnimationFrame(() => document.querySelector(`[aria-label="${t("parts.partNumber")} ${origin + 1}"]`)?.focus());
  }

  const serializedDialog = serializedDialogPart ? <WorkorderSerializedPartDialog
    open
    actorId={actorId}
    workorderId={detail.workorder.id}
    catalogPart={serializedDialogPart}
    locale={locale}
    onClose={closeSerializedDialog}
    onReserved={async (usage) => {
      try {
        await serializedParts?.recordUsage?.(usage);
      } catch {
        // Reservation already succeeded. Keep the canonical row and offer a
        // recoverable refresh state rather than inviting a duplicate scan.
        setMessage("Part added; refresh the workorder if the serialized row is not visible.");
      }
      setSerializedDialogPart(null);
    }}
  /> : null;
  const measuredDialog = measuredDialogPart ? <MeasuredPartUsageDialog
    open actorId={actorId} workorderId={detail.workorder.id} catalogPart={measuredDialogPart} locale={locale}
    onClose={closeMeasuredDialog} onReserved={onChanged}
  /> : null;

  if (!partsEditable && !laborEditable) {
    const savedParts = [...(serializedParts ? [] : installedParts), ...readonlyUsedParts(parts)];
    return (
      <div className="used-parts-editor is-readonly" aria-label={t("parts.usedTitle")}>
        {serializedToolbar}
        {serializedFeedback}
        <p className="used-parts-readonly-state" role="status">{readOnlyText}</p>
        {activeSerializedParts.length ? (
          <div className="parts-editor">
            <div className="part-row part-row-head" aria-hidden="true">
              <span>{t("parts.serialNumber")}</span>
              <span>{t("parts.partNumber")}</span>
              <span>{t("parts.quantityUnit")}</span>
              <span>{t("parts.repairOrder")}</span>
              <span>{t("parts.statusAction")}</span>
            </div>
            {activeSerializedParts.map(renderSerializedPartRow)}
          </div>
        ) : null}
        {laborHours || laborRepairOrder ? (
          <ul className="used-parts-readonly-list">
            <li>
              <strong>{laborProductLabel(laborProduct)}</strong>
              <span>{laborHours} hr</span>
              {laborRepairOrder ? <span>{laborRepairOrder}</span> : null}
            </li>
          </ul>
        ) : null}
        {savedParts.length ? (
          <ul className="used-parts-readonly-list">
            {savedParts.map((part, index) => (
              <li key={`${part.partNo}-${index}`}>
                <strong>{part.partNo || t("parts.partNumberNotRecorded")}</strong>
                <span>{formatQuantityUnit(part.qty, part.uomCode)}</span>
                {part.repairOrder ? <span>{part.repairOrder}</span> : null}
                {(part.evidenceId || legacyManualRowsRef.current.has(partFingerprint(part))) ? <small>{t("parts.legacyManualEvidence")}</small> : null}
              </li>
            ))}
          </ul>
        ) : activeSerializedParts.length ? null : <p className="used-parts-empty">{t("parts.noUsedPartsRecorded")}</p>}
        {serializedHistory}
        <AggregatePartUsageRows actorId={actorId} workorderId={detail.workorder.id} usages={aggregatePartUsages} role={role} editable={partsEditable} locale={locale} onChanged={onChanged} />
        {serializedDialog}
        {measuredDialog}
      </div>
    );
  }

  return (
    <div className="used-parts-editor">
      {serializedToolbar}
      {serializedFeedback}
      <div className="parts-editor">
        <div className="part-row part-row-head" aria-hidden="true">
          <span>{t("parts.serialNumber")}</span>
          <span>{t("parts.partNumber")}</span>
          <span>{t("parts.quantityUnit")}</span>
          <span>{t("parts.repairOrder")}</span>
          <span>{t("parts.statusAction")}</span>
        </div>
        <div className="part-row used-part-labor-row">
          <strong>1</strong>
          <div className="used-part-field">
            <span className="used-part-label">{t("parts.labor")}</span>
            <strong className="used-part-labor-name">{laborProductLabel(laborProduct)}</strong>
          </div>
          <div className="used-part-field used-part-quantity">
            <QuantityUnitInput
              id="workorder-labor-hours"
              quantity={laborHours}
              uomCode="hr"
              onValueChange={({ quantity }) => onLaborHoursChange(quantity)}
              quantityLabel={t("parts.laborHours")}
              unitLabel={t("parts.unit")}
              disabled={!laborEditable || laborRepairOrderDisabled}
              unitReadOnly
              compact
              max={9999}
            />
          </div>
          <div className="used-part-field used-part-repair">
            <NarrativeField
              locale={locale}
              singleLine
              value={laborRepairOrder}
              onChange={(event) => onLaborRepairOrderChange(event.target.value)}
              aria-label={t("parts.repairOrderWorkPerformed")}
              placeholder={t("parts.repairOrderWorkPerformed")}
              disabled={!laborEditable || laborRepairOrderDisabled}
            />
          </div>
          <span aria-hidden="true"></span>
        </div>
        {activeSerializedParts.map(renderSerializedPartRow)}
        {partsEditable ? rows.map((part, index) => (
          (() => {
            const legacyManual = Boolean(part.evidenceId) || legacyManualRowsRef.current.has(partFingerprint(part));
            return <div className="part-row" key={index}>
            <strong>{activeSerializedParts.length + index + 2}</strong>
            <div className="used-part-field">
              <span className="used-part-label">{t("parts.partNumber")}</span>
              <div className={`used-part-number-control ${suggestionsEnabled ? "has-suggestion" : ""}`}>
                <PartCatalogCombobox
                  workorderId={detail.workorder.id}
                  purpose="workorder_assignment"
                  value={part.partNo}
                  onChange={(value) => {
                    if (part.evidenceId) return;
                    setSelectedCatalogPart(index, null);
                    updateFields(index, {
                      partNo: value,
                      qty: usedPartQuantityAfterPartNumberChange(part, value),
                    });
                  }}
                  onSelect={(catalogPart) => {
                    setSelectedCatalogPart(index, null);
                    serializedDialogOriginRef.current = index;
                    const category = getUnitDefinition(catalogPart.uomCode)?.category;
                    setMessage("");
                    if (MEASURED_UOM_CATEGORIES.has(category)) { measuredDialogOriginRef.current = index; setMeasuredDialogPart(catalogPart); }
                    else if (category === "time") setMessage(t("parts.timeInventoryUnsupported"));
                    else setSerializedDialogPart(catalogPart);
                  }}
                  label={`${t("parts.partNumber")} ${index + 1}`}
                  inputAriaLabel={`${t("parts.partNumber")} ${index + 1}`}
                  inputPolicy="identifier"
                  placeholder={t("parts.partNumber")}
                  disabled={!partsEditable || legacyManual}
                  locale={locale}
                />
                {suggestionsEnabled ? (
                  <button type="button" onClick={() => suggestRepair(index)} disabled={!partsEditable || legacyManual || findingRow >= 0 || !looksLikePartNumber(part.partNo)} title={t("parts.findDetails")} aria-label={`${t("parts.findDetails")} ${index + 1}`}>
                    <SearchMd />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="used-part-field used-part-quantity">
              <QuantityUnitInput
                id={`used-part-quantity-${index}`}
                quantity={part.qty}
                uomCode={part.uomCode}
                onValueChange={({ quantity, uomCode }) => updateFields(index, { qty: quantity, uomCode })}
                quantityLabel={`${t("parts.quantity")} ${index + 1}`}
                unitLabel={`${t("parts.unit")} ${index + 1}`}
                disabled={!partsEditable || legacyManual}
                compact
              />
            </div>
            <div className="used-part-field used-part-repair">
              <NarrativeField
                locale={locale}
                singleLine
                value={part.repairOrder}
                onChange={(event) => update(index, "repairOrder", event.target.value)}
                aria-label={`${t("parts.repairOrder")} ${index + 1}`}
                placeholder={t("parts.describeRepair")}
                disabled={!partsEditable || legacyManual}
              />
            </div>
            <div className="used-part-row-action">{legacyManual ? <small>{t("parts.legacyManualEvidence")}</small> : <button className="remove-row" type="button" onClick={() => removeRow(index)} disabled={!partsEditable} aria-label={`${t("parts.removePartRow")} ${index + 1}`}>{t("parts.remove")}</button>}</div>
            {selectedCatalogParts[index]?.id ? <div className="used-part-history">
              <RepairHistorySuggestions
                workorderId={detail.workorder.id}
                catalogPartId={selectedCatalogParts[index]?.id}
                partNumber={selectedCatalogParts[index]?.partNumber}
                assetId={detail.workorder.asset?.id || detail.workorder.assetId}
                onApply={(text) => update(index, "repairOrder", text)}
                disabled={!partsEditable}
                locale={locale}
              />
            </div> : null}
          </div>;
          })()
        )) : null}
      </div>
      {!partsEditable ? (
        <div className="used-parts-locked-list">
          <p className="used-parts-readonly-state" role="status">{readOnlyText}</p>
          {readonlyUsedParts(parts).length ? (
            <ul className="used-parts-readonly-list">
              {readonlyUsedParts(parts).map((part, index) => (
                <li key={`${part.partNo}-${index}`}>
                  <strong>{part.partNo || t("parts.partNumberNotRecorded")}</strong>
                  <span>{formatQuantityUnit(part.qty, part.uomCode)}</span>
                  {part.repairOrder ? <span>{part.repairOrder}</span> : null}
                  {(part.evidenceId || legacyManualRowsRef.current.has(partFingerprint(part))) ? <small>{t("parts.legacyManualEvidence")}</small> : null}
                </li>
              ))}
            </ul>
          ) : <p className="used-parts-empty">{t("parts.noUsedPartsRecorded")}</p>}
        </div>
      ) : null}
      {serializedHistory}
      <AggregatePartUsageRows actorId={actorId} workorderId={detail.workorder.id} usages={aggregatePartUsages} role={role} editable={partsEditable} locale={locale} onChanged={onChanged} />
      {partsEditable ? (
        <Button icon={Plus} onClick={addRow} disabled={rows.length >= MAX_USED_PARTS}>
          {rows.length ? t("parts.addAnotherPart") : t("parts.recordUsedPart")}
        </Button>
      ) : null}
      <div className="used-parts-feedback" aria-live="polite">
        {message ? <span>{message}</span> : <span></span>}
        {saveState ? <strong>{saveState}</strong> : null}
      </div>
      {serializedDialog}
      {measuredDialog}
    </div>
  );
}
