import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.js";
import { QuantityUnitInput } from "../forms/QuantityUnitInput.jsx";
import { NarrativeField } from "../forms/NarrativeField.jsx";
import { formatQuantityUnit } from "../forms/quantity-unit-model.js";
import { Button } from "../ui/Button.jsx";
import {
  readonlyUsedParts,
  serializedUsageTableState,
} from "./used-parts-model.js";
import { createSerializedRepairAutosave } from "./serialized-repair-autosave.js";
import "./used-parts-editor.css";
import { PartCatalogCombobox } from "./part-requests/PartCatalogCombobox.jsx";
import { WorkorderSerializedPartDialog } from "./part-requests/WorkorderSerializedPartDialog.jsx";
import { AggregatePartUsageRows, MeasuredPartUsageDialog } from "./part-requests/MeasuredPartUsageDialog.jsx";
import { RepairHistorySuggestions } from "./part-requests/RepairHistorySuggestions.jsx";
import { laborProductLabel } from "../../../../shared/labor-product.js";
import { interfaceText } from "../../i18n/index.js";
import { getUnitDefinition } from "../../../../shared/units-of-measure.js";

const MEASURED_UOM_CATEGORIES = new Set(["liquid_volume", "mass", "gas_volume", "length"]);

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
  onChanged = () => {},
  onRegisterSerializedRepairFlush = () => {},
  serializedParts = null,
  disabled = false,
  partsEditable = !disabled,
  laborEditable = !disabled,
  suggestionsEnabled = true,
  locale = "en",
  readonlyMessage = "Used parts are read-only for your role.",
}) {
  const t = (key) => interfaceText(locale, key);
  const readOnlyText = locale === "en" ? readonlyMessage : t("parts.usedPartsReadOnly");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [message, setMessage] = useState("");
  const [serializedDialogPart, setSerializedDialogPart] = useState(null);
  const [measuredDialogPart, setMeasuredDialogPart] = useState(null);
  const [serializedRepairOrders, setSerializedRepairOrders] = useState({});
  const [savingSerializedUsageId, setSavingSerializedUsageId] = useState("");
  const focusedSerializedUsageId = serializedParts?.focusUsageId || "";
  const serializedRepairContextRef = useRef(null);
  const serializedRepairAutosaveRef = useRef(null);
  serializedRepairContextRef.current = { detail, locale, onChanged, serializedParts };
  if (!serializedRepairAutosaveRef.current) {
    serializedRepairAutosaveRef.current = createSerializedRepairAutosave({
      save: async (part, repairOrder) => {
        const context = serializedRepairContextRef.current;
        const result = await api(`/api/workorders/${encodeURIComponent(context.detail.workorder.id)}/modules/parts/actions/record`, {
          method: "POST",
          body: JSON.stringify({
            operation: "serializedUsageRepairOrder",
            usageId: part.usageId,
            repairOrder,
          }),
        });
        context.serializedParts?.updateUsage?.(result.result?.usage);
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
                  currentRepairOrder={serializedRepairOrder(part)}
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
            {actions.remove ? <Button type="button" onClick={() => serializedParts.requestRemove(usage)} disabled={rowBusy}>
              {t("parts.removeFromUnit")}
            </Button> : null}
          </div>
        </div>
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
    setSerializedDialogPart(null);
  }

  function closeMeasuredDialog() {
    setMeasuredDialogPart(null);
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
              </li>
            ))}
          </ul>
        ) : activeSerializedParts.length ? null : <p className="used-parts-empty">{t("parts.noUsedPartsRecorded")}</p>}
        {serializedHistory}
        <AggregatePartUsageRows actorId={actorId} workorderId={detail.workorder.id} usages={aggregatePartUsages} role={role} editable={partsEditable} locale={locale} onChanged={onChanged} />
        {measuredDialog}
      </div>
    );
  }

  return (
    <div className="used-parts-editor">
      {serializedToolbar}
      {serializedFeedback}
      {partsEditable ? <div className="used-parts-manual-picker">
        <PartCatalogCombobox
          workorderId={detail.workorder.id}
          purpose="workorder_assignment"
          value={catalogQuery}
          onChange={(value) => {
            setCatalogQuery(value);
            setSerializedDialogPart(null);
          }}
          onSelect={(catalogPart) => {
            const category = getUnitDefinition(catalogPart.uomCode)?.category;
            setCatalogQuery(catalogPart.partNumber);
            setMessage("");
            if (MEASURED_UOM_CATEGORIES.has(category)) setMeasuredDialogPart(catalogPart);
            else if (category === "time") setMessage(t("parts.timeInventoryUnsupported"));
            else setSerializedDialogPart(catalogPart);
          }}
          label={t("parts.partNumber")}
          inputAriaLabel={t("parts.partNumber")}
          inputPolicy="identifier"
          placeholder={t("parts.partNumber")}
          allowManualEntry={false}
          locale={locale}
        />
        {serializedDialog}
      </div> : null}
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
      </div>
      {readonlyUsedParts(parts).length ? (
        <ul className="used-parts-readonly-list">
          {readonlyUsedParts(parts).map((part, index) => (
            <li key={`${part.partNo}-${index}`}>
              <strong>{part.partNo || t("parts.partNumberNotRecorded")}</strong>
              <span>{formatQuantityUnit(part.qty, part.uomCode)}</span>
              {part.repairOrder ? <span>{part.repairOrder}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {serializedHistory}
      <AggregatePartUsageRows actorId={actorId} workorderId={detail.workorder.id} usages={aggregatePartUsages} role={role} editable={partsEditable} locale={locale} onChanged={onChanged} />
      <div className="used-parts-feedback" aria-live="polite">
        {message ? <span>{message}</span> : <span></span>}
      </div>
      {measuredDialog}
    </div>
  );
}
