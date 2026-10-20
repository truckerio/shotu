import { canViewWorkorderPrices } from "../../../../shared/workorder-pricing-access.js";
import { Plus, Trash01 } from "@untitledui/icons";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../../lib/api.js";
import { QuantityUnitInput } from "../forms/QuantityUnitInput.jsx";
import { NarrativeField } from "../forms/NarrativeField.jsx";
import { formatQuantityUnit } from "../forms/quantity-unit-model.js";
import { Button } from "../ui/Button.jsx";
import { IconButton } from "../ui/IconButton.jsx";
import { PartRowActions } from "./PartRowActions.jsx";
import { PartRemovalDialog } from "./PartRemovalDialog.jsx";
import {
  availableUsedPartDraftCount,
  canAddUsedPartDraft,
  emptyUsedPart,
  initialUsedPartRows,
  groupSerializedUsageRows,
  noStockUsedPartDraft,
  readonlyUsedParts,
  removeUsedPartDraft,
  reusableReturnedUsageIds,
  savableNoStockUsedPart,
  serializedUsageTableState,
  usedPartHasValue,
} from "./used-parts-model.js";
import { createSerializedRepairAutosave } from "./serialized-repair-autosave.js";
import "./used-parts-editor.css";
import { PartCatalogCombobox } from "./part-requests/PartCatalogCombobox.jsx";
import { WorkorderSerializedPartDialog } from "./part-requests/WorkorderSerializedPartDialog.jsx";
import { AggregatePartUsageRows, MeasuredPartUsageDialog } from "./part-requests/MeasuredPartUsageDialog.jsx";
import { PartRepairOrderField } from "./part-requests/PartRepairOrderField.jsx";
import { laborProductLabel } from "../../../../shared/labor-product.js";
import { LaborProductSelector } from "./LaborProductSelector.jsx";
import { interfaceText } from "../../i18n/index.js";
import { getUnitDefinition } from "../../../../shared/units-of-measure.js";
import { partStockTracking } from "../inventory/stock-intake-model.js";
import { textEntryProps } from "../forms/text-entry-policy.js";
import {
  DETAIL_WORKORDER_PARTS_COLUMNS,
  WORKORDER_PARTS_COLUMNS,
  WorkorderPartsActions,
  WorkorderPartsColumnHead,
  WorkorderPartsRow,
  WorkorderPartsTable,
} from "./WorkorderPartsTable.jsx";
import { WorkorderPartsEntryTable } from "./WorkorderPartsEntryTable.jsx";
import { WorkorderPartPriceCell } from "./WorkorderPartPriceCell.jsx";
import { LaborPriceCell } from "./LaborPriceCell.jsx";
import { WorkorderPricingSummary } from "./WorkorderPricingSummary.jsx";

export function UsedPartsEditor({
  actorId,
  financialFooter = null,
  role = "read",
  detail,
  parts,
  laborHours = "",
  laborProduct = null,
  locationId = "",
  laborRepairOrder = "",
  laborRepairOrderDisabled = false,
  laborLogContent = null,
  installedParts = [],
  onLaborHoursChange = () => {},
  onLaborProductChange,
  onLaborRepairOrderChange = () => {},
  onChange = () => {},
  onSave = null,
  onChanged = () => {},
  onRegisterSerializedRepairFlush = () => {},
  serializedParts = null,
  disabled = false,
  partsEditable = !disabled,
  laborEditable = !disabled,
  headerAction = null,
  suggestionsEnabled = true,
  locale = "en",
  readonlyMessage = "Used parts are read-only for your role.",
  presentation = "panel",
}) {
  const t = (key) => interfaceText(locale, key);
  const readOnlyText = locale === "en" ? readonlyMessage : t("parts.usedPartsReadOnly");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [serializedDialogPart, setSerializedDialogPart] = useState(null);
  const [measuredDialogPart, setMeasuredDialogPart] = useState(null);
  const [noStockDraft, setNoStockDraft] = useState(null);
  const [savingNoStock, setSavingNoStock] = useState(false);
  const [removalTarget, setRemovalTarget] = useState(null);
  const [draftRows, setDraftRows] = useState(() => role === "mechanic" ? [] : initialUsedPartRows([]));
  const [activeDraftIndex, setActiveDraftIndex] = useState(-1);
  const [expandedSerializedGroups, setExpandedSerializedGroups] = useState(new Set());
  const [serializedHistoryOpen, setSerializedHistoryOpen] = useState(false);
  const [serializedRepairOrders, setSerializedRepairOrders] = useState({});
  const [savingSerializedUsageId, setSavingSerializedUsageId] = useState("");
  const focusedSerializedUsageId = serializedParts?.focusUsageId || "";
  const serializedRepairContextRef = useRef(null);
  const serializedRepairAutosaveRef = useRef(null);
  const serializedReservationCompletedRef = useRef(false);
  const intakeRowRef = useRef(null);
  const laborSectionTitleId = useId();
  const partsSectionTitleId = useId();
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
      const row = document.getElementById(`serialized-part-${focusedSerializedUsageId}`)
        || document.querySelector(`[data-serialized-usage-ids~="${CSS.escape(focusedSerializedUsageId)}"]`);
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
  const activeSerializedParts = groupSerializedUsageRows(serializedUsageState.active);
  const completedSerializedUsages = serializedUsageState.completed;
  const reusableReturnedIds = reusableReturnedUsageIds(serializedParts?.usages);
  const returnedUsageKey = [...reusableReturnedIds].join(":");
  const aggregatePartUsages = detail?.modules?.parts?.data?.aggregatePartUsages || detail?.aggregatePartUsages || [];
  const noStockPartPrices = detail?.modules?.parts?.data?.noStockPartPrices || [];
  const noStockPriceByLineId = new Map(noStockPartPrices.map((entry) => [entry.noStockLineId, entry.price]));
  const recordedManualParts = readonlyUsedParts(parts);
  const recordedPartCount = serializedUsageState.active.length + recordedManualParts.length + aggregatePartUsages.length;
  const visibleDraftRows = draftRows.slice(0, availableUsedPartDraftCount(recordedPartCount, draftRows.length));
  const hasTablePartRows = activeSerializedParts.length > 0 || recordedManualParts.length > 0 || aggregatePartUsages.length > 0;
  const onePage = presentation === "one-page";
  const canViewPrices = canViewWorkorderPrices(role);
  const laborUomCode = laborProduct?.uomCode === "ea" ? "ea" : "hr";
  const laborQuantityLabel = laborUomCode === "ea" ? "Service quantity" : t("parts.laborHours");
  const laborPrice = detail?.modules?.diagnosisRepair?.data?.laborPrice || detail?.laborPrice || null;
  const currentLaborRates = detail?.modules?.diagnosisRepair?.data?.currentLaborRates || detail?.currentLaborRates || {};
  const workorderPricing = detail?.workorderPricing || detail?.modules?.parts?.data?.workorderPricing || null;
  const savedForm = detail?.workorder?.formData || {};
  const ratesForProduct = String(savedForm.laborProduct?.productId || "") === String(laborProduct?.productId || "")
    ? currentLaborRates : {};
  const laborDraftChanged = Number(savedForm.laborHours || 0) !== Number(laborHours || 0)
    || String(savedForm.laborProduct?.productId || "") !== String(laborProduct?.productId || "")
    || (savedForm.laborProduct?.uomCode === "ea" ? "ea" : "hr") !== laborUomCode;
  const pricingForDisplay = laborDraftChanged && workorderPricing?.status === "complete"
    ? { status: "incomplete", missingCount: 1 }
    : workorderPricing;
  const effectiveLocationId = locationId || detail?.workorder?.locationId || detail?.workorder?.location?.id || "";
  const laborGridTemplate = canViewPrices
    ? "24px minmax(0, 1.1fr) minmax(126px, .85fr) minmax(0, 1fr) minmax(220px, 1fr)"
    : undefined;
  const laborColumns = canViewPrices
    ? [WORKORDER_PARTS_COLUMNS.PRODUCT, WORKORDER_PARTS_COLUMNS.QUANTITY_UOM, WORKORDER_PARTS_COLUMNS.REPAIR_ORDER, WORKORDER_PARTS_COLUMNS.PRICE]
    : undefined;
  const partColumns = canViewPrices
    ? [
      ...DETAIL_WORKORDER_PARTS_COLUMNS.slice(0, -1),
      WORKORDER_PARTS_COLUMNS.PRICE,
      DETAIL_WORKORDER_PARTS_COLUMNS.at(-1),
    ]
    : DETAIL_WORKORDER_PARTS_COLUMNS;

  useEffect(() => {
    if (returnedUsageKey) setSerializedHistoryOpen(true);
  }, [returnedUsageKey]);

  function addSerializedUnits(part) {
    setActiveDraftIndex(-1);
    setSerializedDialogPart({ id: part.catalogPartId, partNumber: part.partNo, uomCode: part.uomCode });
  }

  function toggleSerializedGroup(key) {
    setExpandedSerializedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderSerializedPartRow(part, index, ordinal = index + 2, compact = false, nested = false) {
    const members = part.memberParts || [part];
    const grouped = !nested && members.length > 1;
    const groupKey = `${part.catalogPartId}:${part.uomCode}`;
    const expanded = grouped && expandedSerializedGroups.has(groupKey);
    const canAddUnits = !nested && partsEditable && Boolean(serializedParts && part.catalogPartId);
    const manageUnits = <Button type="button" aria-expanded={expanded} onClick={() => toggleSerializedGroup(groupKey)}>{t("parts.serialDetails")} ({members.length})</Button>;
    const usage = part.usage;
    const actions = usage && serializedParts ? serializedParts.actionsFor(usage) : {};
    const installed = ["installed_pending_approval", "installed"].includes(part.status);
    const status = grouped ? t("parts.selectedSerializedUnits") : usage && serializedParts ? serializedParts.statusLabel(usage.status) : t("parts.installed");
    const rowBusy = Boolean(serializedParts?.busy);
    const rowId = grouped ? `serialized-group-${part.catalogPartId}-${part.uomCode}` : usage?.id ? `serialized-part-${usage.id}` : undefined;
    return (
      <div className="used-part-serialized-group" key={`serialized-${part.usageId || part.catalogPartId || part.partNo}-${index}`}>
        <WorkorderPartsRow
          id={rowId}
          data-serialized-usage-ids={members.map((member) => member.usageId).filter(Boolean).join(" ")}
          className="used-part-serialized-row"
          tabIndex={rowId ? -1 : undefined}
          aria-label={`${part.partNo}, ${formatQuantityUnit(part.qty, part.uomCode)}, ${status}`}
        >
          <strong>{ordinal}</strong>
          <div className="used-part-field used-part-serialized-identity">
            <span className="used-part-cell-label">{t("parts.part")}</span>
            {grouped || canAddUnits ? <button type="button" className="used-part-name-field"
              aria-label={`${t("parts.serialDetails")}: ${part.partNo}`}
              aria-expanded={grouped ? expanded : undefined}
              onClick={() => grouped ? toggleSerializedGroup(groupKey) : addSerializedUnits(part)}
              disabled={rowBusy}>{part.partNo}</button> : <span className="used-part-name-field">{part.partNo}</span>}
            {grouped ? <small className="used-part-serialized-serial">{members.length} {t("parts.serialNumbers")}</small> : part.serialNumber ? <small className="used-part-serialized-serial">{t("parts.serial")}: {part.serialNumber}</small> : null}
            {savingSerializedUsageId === part.usageId ? <small className="used-part-row-status">{t("progress.saving")}</small> : part.status !== "reserved" ? <small className="used-part-row-status">{status}</small> : null}
          </div>
          <div className="used-part-field used-part-serialized-value">
            <span className="used-part-cell-label">{t("parts.quantityUnit")}</span>
            <QuantityUnitInput
              id={`serialized-quantity-${part.usageId}${nested ? "-detail" : ""}`}
              quantity={part.qty}
              uomCode={part.uomCode}
              quantityLabel={`${t("parts.quantity")}: ${part.partNo}${nested ? ` ${part.serialNumber}` : ""}`}
              unitLabel={t("parts.unit")}
              quantityReadOnly
              unitReadOnly
              disabled={rowBusy || !canAddUnits}
              onQuantityActivate={canAddUnits ? () => addSerializedUnits(part) : undefined}
              quantityHint={canAddUnits ? t("parts.selectMoreSerializedUnits") : undefined}
              compact
              locale={locale}
            />
          </div>
          <div className="used-part-field used-part-repair">
            <span className="used-part-cell-label">{t("parts.repairOrder")}</span>
            {grouped ? manageUnits : installed ? (
              <PartRepairOrderField
                historyEnabled={suggestionsEnabled && Boolean(part.usageId)}
                workorderId={detail.workorder.id}
                catalogPartId={part.catalogPartId}
                partNumber={part.partNo}
                assetId={detail.workorder.asset?.id || detail.workorder.assetId}
                currentRepairOrder={serializedRepairOrder(part)}
                onApply={(text) => updateSerializedRepairOrder(part, text)}
                disabled={disabled || !part.usageId || savingSerializedUsageId === part.usageId}
                locale={locale}
              >
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
              </PartRepairOrderField>
            ) : actions.install ? (
              <Button
                type="button"
                className="used-part-install"
                onClick={() => serializedParts.finalize(usage, "installed")}
                disabled={rowBusy}
              >
                {t("parts.markInstalled")}
              </Button>
            ) : <span className="used-part-pending-repair">{t("parts.repairAfterInstalled")}</span>}
          </div>
          {!compact ? <span className="used-part-pickup-empty" aria-hidden="true"></span> : null}
          {canViewPrices ? grouped ? <span className="used-part-group-price">{t("parts.pricePerSerial")}</span> : <WorkorderPartPriceCell compact={compact} workorderId={detail.workorder.id} usageKind="serialized" usageId={part.usageId} catalogPartId={part.catalogPartId} partLabel={part.partNo} locationId={effectiveLocationId} uomCode={part.uomCode} price={part.price} quantity={part.qty} onChanged={onChanged} disabled={!partsEditable} /> : null}
          <div className="used-part-serialized-actions">
            {!grouped ? <PartRowActions label={`More actions for ${part.partNo}`} disabled={rowBusy} actions={[
              actions.returnUnused && { id: "return", label: t("parts.returnUnused"), onAction: () => serializedParts.finalize(usage, "returned") },
              actions.remove && { id: "remove", label: t("parts.removeFromUnit"), onAction: () => serializedParts.requestRemove(usage) },
            ]} /> : null}
          </div>
        </WorkorderPartsRow>
        {expanded ? <div className="used-part-serial-details" role="group" aria-label={`${t("parts.serialDetails")}: ${part.partNo}`}>
          {members.map((member, memberIndex) => renderSerializedPartRow(member, memberIndex, `${ordinal}.${memberIndex + 1}`, compact, true))}
        </div> : null}
      </div>
    );
  }

  function renderRecordedPartRow(part, index, ordinal, compact = false) {
    const partNumber = part.partNo || t("parts.partNumberNotRecorded");
    const quantity = formatQuantityUnit(part.qty, part.uomCode);
    return (
      <WorkorderPartsRow
        className="used-part-recorded-row"
        key={`recorded-${part.partNo || "part"}-${index}`}
        aria-label={`${partNumber}, ${quantity}`}
      >
        <strong>{ordinal}</strong>
        <div className="used-part-field used-part-recorded-identity"><span className="used-part-cell-label">{t("parts.part")}</span><span className="used-part-name-field">{partNumber}</span></div>
        <div className="used-part-field used-part-recorded-value"><span className="used-part-cell-label">{t("parts.quantityUnit")}</span><strong>{quantity}</strong></div>
        <div className="used-part-field used-part-recorded-repair"><span className="used-part-cell-label">{t("parts.repairOrder")}</span>{part.repairOrder || <span aria-hidden="true">—</span>}</div>
        {!compact ? <span className="used-part-pickup-empty" aria-hidden="true"></span> : null}
        {canViewPrices ? part.trackingMode === "no_stock" && part.noStockLineId
          ? <WorkorderPartPriceCell compact={compact} workorderId={detail.workorder.id} usageKind="no_stock" noStockLineId={part.noStockLineId} catalogPartId={part.catalogPartId} partLabel={part.partNo} locationId={effectiveLocationId} uomCode={part.uomCode} price={noStockPriceByLineId.get(part.noStockLineId) || null} quantity={part.qty} onChanged={onChanged} disabled={!partsEditable} />
          : <span className="used-part-price-unavailable">Price unavailable · not linked to inventory</span> : null}
        {partsEditable && part.trackingMode === "no_stock" && part.noStockLineId
          ? <IconButton icon={Trash01} tone="danger" label={`${t("parts.removePartRow")}: ${partNumber}`} onClick={() => { setMessage(""); setRemovalTarget({ part }); }} disabled={savingNoStock || !onSave} />
          : <span className="used-part-recorded-status" aria-hidden="true"></span>}
      </WorkorderPartsRow>
    );
  }

  function renderReadonlyLaborRow() {
    return (
      <WorkorderPartsRow className="used-part-labor-row" aria-label={laborQuantityLabel}>
        <strong>1</strong>
        <div className="used-part-field"><strong className="used-part-labor-name">{laborProductLabel(laborProduct)}</strong></div>
        <div className="used-part-field used-part-recorded-value"><strong>{laborHours ? formatQuantityUnit(laborHours, laborUomCode) : "—"}</strong></div>
        <div className="used-part-field used-part-recorded-repair">{laborRepairOrder || <span aria-hidden="true">—</span>}</div>
        {canViewPrices ? <LaborPriceCell workorderId={detail.workorder.id} locationId={effectiveLocationId} productId={laborProduct?.productId} hours={laborHours} uomCode={laborUomCode} price={laborPrice} currentRates={ratesForProduct} onChanged={onChanged} disabled /> : <span aria-hidden="true"></span>}
      </WorkorderPartsRow>
    );
  }

  const serializedToolbar = serializedParts?.scanControl || null;
  const onePageToolbar = serializedParts?.scanControl || null;
  const laborControlsDisabled = !laborEditable || laborRepairOrderDisabled;

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
    <details className="used-parts-serialized-history" open={serializedHistoryOpen} onToggle={(event) => setSerializedHistoryOpen(event.currentTarget.open)}>
      <summary>{t("parts.previousScannedParts")} ({completedSerializedUsages.length})</summary>
      <ol aria-label={t("parts.completedSerializedHistory")}>
        {completedSerializedUsages.map((usage) => (
          <li key={usage.id}>
            <span><strong>{usage.partNumber}</strong><code>{usage.serialNumber}</code></span>
            <div className="used-parts-serialized-history-actions">
              <small>{usage.status === "returned" ? t("parts.returnedToStock") : serializedParts.statusLabel(usage.status)}</small>
              {partsEditable && reusableReturnedIds.has(usage.id) ? <Button type="button" onClick={() => reuseReturnedUnit(usage)} disabled={serializedParts?.busy}>
                {t("parts.useOnWorkorder")}
              </Button> : null}
            </div>
          </li>
        ))}
      </ol>
    </details>
  ) : null;

  function closeSerializedDialog() {
    setSerializedDialogPart(null);
    if (serializedReservationCompletedRef.current) {
      serializedReservationCompletedRef.current = false;
      if (activeDraftIndex >= 0) {
        resetDraftRow(activeDraftIndex);
        setActiveDraftIndex(-1);
      } else {
        setCatalogQuery("");
        setIntakeOpen(false);
      }
    }
  }

  function closeMeasuredDialog() {
    setMeasuredDialogPart(null);
  }

  function resetIntakeRow() {
    serializedReservationCompletedRef.current = false;
    setCatalogQuery("");
    setSerializedDialogPart(null);
    setMeasuredDialogPart(null);
    setNoStockDraft(null);
    setMessage("");
  }

  function updateDraftRow(index, changes) {
    setDraftRows((current) => current.map((row, rowIndex) => (
      rowIndex === index ? { ...row, ...changes } : row
    )));
  }

  function resetDraftRow(index) {
    if (index < 0) return;
    setDraftRows((current) => current.map((row, rowIndex) => (
      rowIndex === index ? emptyUsedPart() : row
    )));
  }

  function addDraftRow() {
    setDraftRows((current) => canAddUsedPartDraft(recordedPartCount, current.length) ? [...current, emptyUsedPart()] : current);
    window.requestAnimationFrame(() => {
      const inputs = document.querySelectorAll(".used-parts-draft-row .part-catalog-field input");
      inputs.item(inputs.length - 1)?.focus();
    });
  }

  function deleteDraftRow(index) {
    const result = removeUsedPartDraft(draftRows, index, activeDraftIndex);
    if (!result || savingNoStock || !partsEditable) return;
    setDraftRows(result.rows);
    setActiveDraftIndex(result.activeIndex);
    if (result.removedActive) resetIntakeRow();
    setRemovalTarget(null);
    window.requestAnimationFrame(() => document.getElementById("workorder-add-approved-part")?.focus());
  }

  function requestDraftRemoval(index) {
    if (usedPartHasValue(draftRows[index])) {
      setMessage("");
      setRemovalTarget({ index });
    } else deleteDraftRow(index);
  }

  function focusIntakeRow() {
    if (!intakeOpen) {
      resetIntakeRow();
      setIntakeOpen(true);
    }
    window.requestAnimationFrame(() => intakeRowRef.current?.querySelector("input")?.focus());
  }

  function reuseReturnedUnit(usage) {
    setActiveDraftIndex(-1);
    serializedReservationCompletedRef.current = false;
    setCatalogQuery(usage.partNumber || "");
    setMessage("");
    setIntakeOpen(true);
    setSerializedDialogPart({
      id: usage.catalogPartId,
      partNumber: usage.partNumber,
      description: usage.description || "",
      uomCode: usage.uomCode,
      locationName: usage.locationName || "",
      initialUnitId: usage.unitId,
      initialSerialNumber: usage.serialNumber,
    });
  }

  function closeIntakeRow() {
    resetIntakeRow();
    setIntakeOpen(false);
    window.requestAnimationFrame(() => document.getElementById("workorder-add-approved-part")?.focus());
  }

  async function addNoStockPart(draft = noStockDraft, draftIndex = -1) {
    if (draftIndex >= 0 && availableUsedPartDraftCount(recordedPartCount, 1) === 0) {
      setMessage("This Workorder already has the maximum number of recorded parts.");
      return;
    }
    if (!onSave) {
      setMessage("This Workorder cannot save no-stock items right now.");
      return;
    }
    const part = savableNoStockUsedPart(draft);
    if (!part) {
      setMessage(t("parts.validation.quantity"));
      return;
    }
    setMessage("");
    setSavingNoStock(true);
    const nextParts = [...recordedManualParts, part];
    try {
      const saved = await onSave(nextParts);
      onChange(saved?.parts || nextParts);
      if (draftIndex >= 0) {
        resetDraftRow(draftIndex);
        setActiveDraftIndex(-1);
        setNoStockDraft(null);
      } else closeIntakeRow();
      await onChanged();
    } catch (error) {
      setMessage(error?.message || "No-stock item could not be added.");
    } finally {
      setSavingNoStock(false);
    }
  }

  async function removeNoStockPart(part) {
    if (!onSave || !part?.noStockLineId || savingNoStock || !partsEditable) return;
    setMessage("");
    setSavingNoStock(true);
    const nextParts = recordedManualParts.filter((candidate) => candidate.noStockLineId !== part.noStockLineId);
    try {
      const saved = await onSave(nextParts);
      onChange(saved?.parts || nextParts);
      setRemovalTarget(null);
      await onChanged();
    } catch (error) {
      setMessage(error?.message || "No-stock item could not be removed.");
    } finally {
      setSavingNoStock(false);
    }
  }

  function renderPartsColumnHead(columns = partColumns) {
    return <WorkorderPartsColumnHead
      className="used-parts-column-head"
      columns={columns}
      labels={{
        [WORKORDER_PARTS_COLUMNS.PRODUCT]: t("parts.part"),
        [WORKORDER_PARTS_COLUMNS.QUANTITY_UOM]: t("parts.quantityUnit"),
        [WORKORDER_PARTS_COLUMNS.REPAIR_ORDER]: t("parts.repairOrder"),
        [WORKORDER_PARTS_COLUMNS.PICKUP]: "Pickup",
        [WORKORDER_PARTS_COLUMNS.PRICE]: "Price",
        [WORKORDER_PARTS_COLUMNS.STATUS_ACTION]: t("parts.statusAction"),
      }}
    />;
  }

  function selectCatalogPart(catalogPart, draftIndex = -1) {
    if (draftIndex >= availableUsedPartDraftCount(recordedPartCount, draftRows.length)) {
      setMessage("This Workorder already has the maximum number of recorded parts.");
      return;
    }
    const category = getUnitDefinition(catalogPart.uomCode)?.category;
    serializedReservationCompletedRef.current = false;
    setActiveDraftIndex(draftIndex);
    if (draftIndex >= 0) updateDraftRow(draftIndex, { ...emptyUsedPart(), partNo: catalogPart.partNumber });
    else setCatalogQuery(catalogPart.partNumber);
    setNoStockDraft(null);
    setSerializedDialogPart(null);
    setMeasuredDialogPart(null);
    setMessage("");
    if (catalogPart.trackingMode === "no_stock") {
      const draft = noStockUsedPartDraft(catalogPart);
      setNoStockDraft(draft);
      if (draftIndex >= 0) updateDraftRow(draftIndex, draft);
    } else if (["quantity", "measured_bulk"].includes(partStockTracking(catalogPart))) setMeasuredDialogPart(catalogPart);
    else if (category === "time") setMessage(t("parts.timeInventoryUnsupported"));
    else if (partStockTracking(catalogPart) === "serialized") setSerializedDialogPart(catalogPart);
    else setMessage("Review this part’s tracking settings in Inventory before adding stock.");
  }

  function renderDraftPartRow(draft, index, ordinal) {
    const rowNoStockDraft = draft.trackingMode === "no_stock" ? draft : null;
    return <WorkorderPartsRow className="used-part-intake-row used-parts-draft-row" key={`draft-${index}`}>
      <strong>{ordinal}</strong>
      <div className="create-part-identity-field used-parts-manual-picker">
        <PartCatalogCombobox
          workorderId={detail.workorder.id}
          locationId={effectiveLocationId}
          purpose="workorder_assignment"
          value={draft.partNo}
          onChange={(value) => {
            updateDraftRow(index, { ...emptyUsedPart(), partNo: value });
            if (activeDraftIndex === index) {
              setSerializedDialogPart(null);
              setMeasuredDialogPart(null);
              setNoStockDraft(null);
            }
          }}
          onSelect={(catalogPart) => selectCatalogPart(catalogPart, index)}
          label=""
          inputAriaLabel={`${t("parts.numberOrDescription")} ${index + 1}`}
          inputPolicy="identifier"
          placeholder={t("parts.numberOrDescription")}
          allowManualEntry={false}
          locale={locale}
        />
        {activeDraftIndex === index ? serializedDialog : null}
      </div>
      <QuantityUnitInput
        id={`workorder-part-draft-quantity-${index}`}
        quantity={rowNoStockDraft?.qty || ""}
        uomCode={rowNoStockDraft?.uomCode || "pc"}
        onQuantityChange={(qty) => updateDraftRow(index, { qty })}
        quantityLabel={`${t("parts.quantity")} ${index + 1}`}
        unitLabel={`${t("parts.unit")} ${index + 1}`}
        disabled={!rowNoStockDraft || savingNoStock}
        unitReadOnly
        compact
      />
      {rowNoStockDraft ? <PartRepairOrderField
        workorderId={detail.workorder.id}
        locationId={effectiveLocationId}
        catalogPartId={rowNoStockDraft.catalogPartId}
        partNumber={rowNoStockDraft.partNo}
        assetId={detail.workorder.asset?.id || detail.workorder.assetId}
        currentRepairOrder={rowNoStockDraft.repairOrder}
        onApply={(repairOrder) => updateDraftRow(index, { repairOrder })}
        disabled={savingNoStock}
        locale={locale}
        className="used-part-repair"
      >
        <NarrativeField
          locale={locale}
          singleLine
          value={rowNoStockDraft.repairOrder}
          onChange={(event) => updateDraftRow(index, { repairOrder: event.target.value })}
          aria-label={`${t("parts.repairOrder")} ${index + 1}`}
          placeholder={t("parts.repairOrder")}
          disabled={savingNoStock}
        />
      </PartRepairOrderField> : <input {...textEntryProps("identifier")} aria-label={`${t("parts.repairOrder")} ${index + 1}`} placeholder={t("parts.repairOrder")} readOnly />}
      {canViewPrices ? <input aria-label={`Price ${index + 1}`} className="create-price-empty-field" disabled placeholder="Price" value="" /> : null}
      <div className="used-part-intake-actions">
        {rowNoStockDraft ? <Button type="button" variant="primary" onClick={() => addNoStockPart(rowNoStockDraft, index)} disabled={savingNoStock}>
          {savingNoStock ? t("progress.saving") : t("parts.save")}
        </Button> : null}
        <IconButton icon={Trash01} tone="danger" label={`${t("parts.removePartRow")} ${ordinal}`} onClick={() => requestDraftRemoval(index)} disabled={savingNoStock} />
      </div>
    </WorkorderPartsRow>;
  }

  const serializedDialog = serializedDialogPart ? <WorkorderSerializedPartDialog
    canViewPrices={canViewPrices}
    open
    actorId={actorId}
    workorderId={detail.workorder.id}
    catalogPart={serializedDialogPart}
    initialUnitId={serializedDialogPart.initialUnitId}
    initialSerialNumber={serializedDialogPart.initialSerialNumber}
    anchorToPartField={onePage && activeDraftIndex >= 0}
    locale={locale}
    onClose={closeSerializedDialog}
    onReserved={async (usage) => {
      serializedReservationCompletedRef.current = true;
      try {
        await serializedParts?.recordUsage?.(usage);
      } catch {
        // Reservation already succeeded. Keep the canonical row and offer a
        // recoverable refresh state rather than inviting a duplicate scan.
        setMessage("Part added; refresh the workorder if the serialized row is not visible.");
      }
    }}
  /> : null;

  const removalDialog = removalTarget ? <PartRemovalDialog
    saved={Boolean(removalTarget.part)} busy={savingNoStock} error={message} locale={locale}
    onCancel={() => setRemovalTarget(null)}
    onRemove={() => removalTarget.part ? removeNoStockPart(removalTarget.part) : deleteDraftRow(removalTarget.index)}
  /> : null;
  const measuredDialog = measuredDialogPart ? <MeasuredPartUsageDialog
    canViewPrices={canViewPrices}
    allowStockIntake={canViewPrices}
    open actorId={actorId} workorderId={detail.workorder.id} catalogPart={measuredDialogPart} locationId={locationId || detail.workorder.locationId}
    assetId={detail.workorder.asset?.id || detail.workorder.assetId}
    suggestionsEnabled={suggestionsEnabled}
    locale={locale}
    onClose={closeMeasuredDialog} onReserved={async () => {
      if (activeDraftIndex >= 0) {
        resetDraftRow(activeDraftIndex);
        setActiveDraftIndex(-1);
      } else {
        setCatalogQuery("");
        setIntakeOpen(false);
      }
      await onChanged();
    }}
  /> : null;

  if (!partsEditable && !laborEditable && !onePage) {
    const savedParts = recordedManualParts;
    const hasLabor = canViewPrices || Boolean(laborHours || laborRepairOrder);
    return (
      <div className="used-parts-editor workorder-parts-surface is-readonly" aria-label={t("parts.usedTitle")}>
        <p className="used-parts-readonly-state" role="status">{readOnlyText}</p>
        {hasLabor ? <section className="used-parts-section used-parts-labor-section" aria-labelledby={laborSectionTitleId}>
          <h3 id={laborSectionTitleId}>{t("parts.labor")}</h3>
          <WorkorderPartsTable className="detail-operational-parts-editor used-parts-labor-table" columns={laborColumns} gridTemplate={laborGridTemplate}>
            {renderReadonlyLaborRow()}
          </WorkorderPartsTable>
        </section> : null}
        {laborLogContent}
        <section className="used-parts-section used-parts-items-section" aria-labelledby={partsSectionTitleId}>
          <div className="used-parts-section-heading">
            <h3 id={partsSectionTitleId}>{t("parts.usedTitle")}</h3>
            {serializedToolbar}
          </div>
          {serializedFeedback}
          {activeSerializedParts.length || savedParts.length || aggregatePartUsages.length ? <WorkorderPartsTable className="detail-operational-parts-editor used-parts-items-table" columns={partColumns}>
            {renderPartsColumnHead()}
            {activeSerializedParts.map((part, index) => renderSerializedPartRow(part, index, index + (hasLabor ? 2 : 1)))}
            {savedParts.map((part, index) => renderRecordedPartRow(part, index, index + activeSerializedParts.length + (hasLabor ? 2 : 1)))}
            <AggregatePartUsageRows actorId={actorId} workorderId={detail.workorder.id} usages={aggregatePartUsages} role={role} editable={partsEditable} showPrice={canViewPrices} locale={locale} onChanged={onChanged} startOrdinal={activeSerializedParts.length + savedParts.length + (hasLabor ? 2 : 1)} />
          </WorkorderPartsTable> : null}
          {!activeSerializedParts.length && !savedParts.length && !aggregatePartUsages.length ? <p className="used-parts-empty">{t("parts.noUsedPartsRecorded")}</p> : null}
          {serializedHistory}
        </section>
        {canViewPrices && !financialFooter?.hidden ? <WorkorderPricingSummary pricing={financialFooter ? null : pricingForDisplay} {...financialFooter} /> : null}
        {measuredDialog}
        {removalDialog}
      </div>
    );
  }

  if (presentation === "one-page") {
    return (
      <div className="used-parts-editor workorder-parts-surface is-one-page" aria-label={t("parts.usedTitle")}>
        <section className="used-parts-section used-parts-items-section" aria-labelledby={partsSectionTitleId}>
          <div className="used-parts-section-heading">
            <h3 id={partsSectionTitleId}>{t("detail.parts")}</h3>
            <div className="used-parts-heading-actions">{onePageToolbar}{headerAction}</div>
          </div>
          {serializedFeedback}
          <WorkorderPartsEntryTable
            className="detail-operational-parts-editor used-parts-items-table used-parts-one-page-table"
            afterLaborContent={laborLogContent}
            showPrice={canViewPrices}
            labels={{
              [WORKORDER_PARTS_COLUMNS.PRODUCT]: t("parts.part"),
              [WORKORDER_PARTS_COLUMNS.QUANTITY_UOM]: t("parts.quantityUnit"),
              [WORKORDER_PARTS_COLUMNS.REPAIR_ORDER]: t("parts.repairOrder"),
              [WORKORDER_PARTS_COLUMNS.PRICE]: "Price",
            }}
            laborAriaLabel={laborQuantityLabel}
            laborProduct={<div className="used-part-field operational-part-labor-name">
                <span className="used-part-label">{t("parts.labor")}</span>
                <LaborProductSelector canViewPrices={canViewPrices} locationId={locationId} value={laborProduct} onChange={onLaborProductChange || (() => {})} disabled={!laborEditable || !onLaborProductChange} locale={locale} />
              </div>}
            laborQuantity={<QuantityUnitInput id="workorder-labor-hours" quantity={laborHours} uomCode={laborUomCode} onValueChange={({ quantity }) => onLaborHoursChange(quantity)} quantityLabel={laborQuantityLabel} unitLabel={t("parts.unit")} disabled={laborControlsDisabled} unitReadOnly compact max={9999} />}
            laborRepair={<div className="used-part-field used-part-repair"><NarrativeField locale={locale} singleLine value={laborRepairOrder} onChange={(event) => onLaborRepairOrderChange(event.target.value)} aria-label={t("parts.repairOrderWorkPerformed")} placeholder={t("parts.repairOrderWorkPerformed")} disabled={laborControlsDisabled} /></div>}
            laborPrice={canViewPrices ? <LaborPriceCell compact workorderId={detail.workorder.id} locationId={effectiveLocationId} productId={laborProduct?.productId} hours={laborHours} uomCode={laborUomCode} price={laborPrice} currentRates={ratesForProduct} onChanged={onChanged} disabled={!laborEditable} /> : null}
            laborAction={<IconButton icon={Trash01} tone="danger" label="Remove labor selection" onClick={() => onLaborProductChange?.(null)} disabled={!laborEditable || !onLaborProductChange || !laborProduct} />}
          >
            {activeSerializedParts.map((part, index) => renderSerializedPartRow(part, index, index + 2, true))}
            {recordedManualParts.map((part, index) => renderRecordedPartRow(part, index, index + activeSerializedParts.length + 2, true))}
            <AggregatePartUsageRows compact actorId={actorId} workorderId={detail.workorder.id} usages={aggregatePartUsages} role={role} editable={partsEditable} showPrice={canViewPrices} locale={locale} onChanged={onChanged} startOrdinal={activeSerializedParts.length + recordedManualParts.length + 2} />
            {partsEditable ? visibleDraftRows.map((draft, index) => renderDraftPartRow(draft, index, recordedPartCount + index + 2)) : null}
          </WorkorderPartsEntryTable>
          {partsEditable ? <WorkorderPartsActions className="used-parts-actions">
            <Button id="workorder-add-approved-part" type="button" className="create-parts-compact-action" variant="secondary" icon={Plus} onClick={addDraftRow} disabled={!canAddUsedPartDraft(recordedPartCount, draftRows.length)}>
              {t("create.parts.add")}
            </Button>
          </WorkorderPartsActions> : null}
          {serializedHistory}
          {activeDraftIndex < 0 ? serializedDialog : null}
          <div className="used-parts-feedback" aria-live="polite">{message ? <span>{message}</span> : null}</div>
        </section>
        {canViewPrices && !financialFooter?.hidden ? <WorkorderPricingSummary pricing={financialFooter ? null : pricingForDisplay} {...financialFooter} /> : null}
        {measuredDialog}
        {removalDialog}
      </div>
    );
  }

  return (
    <div className="used-parts-editor workorder-parts-surface">
      {!partsEditable ? <p className="used-parts-readonly-state" role="status">{readOnlyText}</p> : null}
      <section className="used-parts-section used-parts-labor-section" aria-labelledby={laborSectionTitleId}>
        <h3 id={laborSectionTitleId}>{t("parts.labor")}</h3>
        <WorkorderPartsTable className="detail-operational-parts-editor used-parts-labor-table" columns={laborColumns} gridTemplate={laborGridTemplate ? `${laborGridTemplate} 64px` : undefined}>
          <WorkorderPartsRow className="used-part-labor-row" aria-label={laborQuantityLabel}>
            <strong>1</strong>
            <div className="used-part-field operational-part-labor-name">
              <span className="used-part-label">{t("parts.labor")}</span>
              <LaborProductSelector
                canViewPrices={canViewPrices}
                locationId={locationId}
                value={laborProduct}
                onChange={onLaborProductChange || (() => {})}
                disabled={!laborEditable}
                locale={locale}
              />
            </div>
            <QuantityUnitInput
              id="workorder-labor-hours"
              quantity={laborHours}
              uomCode={laborUomCode}
              onValueChange={({ quantity }) => onLaborHoursChange(quantity)}
              quantityLabel={laborQuantityLabel}
              unitLabel={t("parts.unit")}
              disabled={!laborEditable || laborRepairOrderDisabled}
              unitReadOnly
              compact
              max={9999}
            />
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
            {canViewPrices ? <LaborPriceCell workorderId={detail.workorder.id} locationId={effectiveLocationId} productId={laborProduct?.productId} hours={laborHours} uomCode={laborUomCode} price={laborPrice} currentRates={ratesForProduct} onChanged={onChanged} disabled={!laborEditable} /> : null}
            <IconButton icon={Trash01} tone="danger" label="Remove labor selection" onClick={() => onLaborProductChange?.(null)} disabled={!laborEditable || !onLaborProductChange || !laborProduct} />
          </WorkorderPartsRow>
        </WorkorderPartsTable>
      </section>
      {laborLogContent}
      <section className="used-parts-section used-parts-items-section" aria-labelledby={partsSectionTitleId}>
        <div className="used-parts-section-heading">
          <h3 id={partsSectionTitleId}>{t("parts.usedTitle")}</h3>
          {serializedToolbar}
        </div>
        {serializedFeedback}
        {hasTablePartRows || intakeOpen ? <WorkorderPartsTable className="detail-operational-parts-editor used-parts-items-table" columns={partColumns}>
          {renderPartsColumnHead()}
          {activeSerializedParts.map((part, index) => renderSerializedPartRow(part, index, index + 2))}
          {recordedManualParts.map((part, index) => renderRecordedPartRow(part, index, index + activeSerializedParts.length + 2))}
          <AggregatePartUsageRows actorId={actorId} workorderId={detail.workorder.id} usages={aggregatePartUsages} role={role} editable={partsEditable} showPrice={canViewPrices} locale={locale} onChanged={onChanged} startOrdinal={activeSerializedParts.length + recordedManualParts.length + 2} />
          {partsEditable && intakeOpen ? <WorkorderPartsRow id="workorder-part-intake-row" className="used-part-intake-row" ref={intakeRowRef}>
            <strong>{activeSerializedParts.length + recordedManualParts.length + aggregatePartUsages.length + 2}</strong>
            <div className="create-part-identity-field used-parts-manual-picker">
              <PartCatalogCombobox
                workorderId={detail.workorder.id}
                purpose="workorder_assignment"
                value={catalogQuery}
                onChange={(value) => {
                  setCatalogQuery(value);
                  setSerializedDialogPart(null);
                  setNoStockDraft(null);
                }}
                onSelect={(catalogPart) => {
                  const category = getUnitDefinition(catalogPart.uomCode)?.category;
                  serializedReservationCompletedRef.current = false;
                  setCatalogQuery(catalogPart.partNumber);
                  setNoStockDraft(null);
                  setSerializedDialogPart(null);
                  setMeasuredDialogPart(null);
                  setMessage("");
                  if (catalogPart.trackingMode === "no_stock") setNoStockDraft(noStockUsedPartDraft(catalogPart));
                  else if (["quantity", "measured_bulk"].includes(partStockTracking(catalogPart))) setMeasuredDialogPart(catalogPart);
                  else if (category === "time") setMessage(t("parts.timeInventoryUnsupported"));
                  else if (partStockTracking(catalogPart) === "serialized") setSerializedDialogPart(catalogPart);
                  else setMessage("Review this part’s tracking settings in Inventory before adding stock.");
                }}
                label=""
                inputAriaLabel={t("parts.numberOrDescription")}
                inputPolicy="identifier"
                placeholder={t("parts.numberOrDescription")}
                allowManualEntry={false}
                locale={locale}
              />
              {serializedDialog}
            </div>
            <QuantityUnitInput
              id="workorder-part-intake-quantity"
              quantity={noStockDraft?.qty || ""}
              uomCode={noStockDraft?.uomCode || "pc"}
              onQuantityChange={(qty) => setNoStockDraft((current) => current ? { ...current, qty } : current)}
              quantityLabel={t("parts.quantity")}
              unitLabel={t("parts.unit")}
              disabled={!noStockDraft || savingNoStock}
              unitReadOnly
              compact
            />
            {noStockDraft ? <PartRepairOrderField
              workorderId={detail.workorder.id}
              locationId={effectiveLocationId}
              catalogPartId={noStockDraft.catalogPartId}
              partNumber={noStockDraft.partNo}
              assetId={detail.workorder.asset?.id || detail.workorder.assetId}
              currentRepairOrder={noStockDraft.repairOrder}
              onApply={(repairOrder) => setNoStockDraft((current) => current ? { ...current, repairOrder } : current)}
              disabled={savingNoStock}
              locale={locale}
              className="used-part-repair"
            >
              <NarrativeField
                locale={locale}
                singleLine
                value={noStockDraft.repairOrder}
                onChange={(event) => setNoStockDraft((current) => current ? { ...current, repairOrder: event.target.value } : current)}
                aria-label={t("parts.repairOrder")}
                placeholder={t("parts.repairOrder")}
                disabled={savingNoStock}
              />
            </PartRepairOrderField> : <input {...textEntryProps("identifier")} aria-label={t("parts.repairOrder")} placeholder={t("parts.repairOrder")} readOnly />}
            <span className="used-part-pickup-empty" aria-hidden="true"></span>
            {canViewPrices ? <span aria-hidden="true"></span> : null}
            <div className="used-part-intake-actions">
              {noStockDraft ? <Button type="button" variant="primary" onClick={addNoStockPart} disabled={savingNoStock}>
                {savingNoStock ? t("progress.saving") : t("parts.save")}
              </Button> : null}
              <Button type="button" onClick={closeIntakeRow} disabled={savingNoStock}>{t("parts.cancel")}</Button>
            </div>
          </WorkorderPartsRow> : null}
        </WorkorderPartsTable> : null}
        {!activeSerializedParts.length && !recordedManualParts.length && !aggregatePartUsages.length && !intakeOpen ? <p className="used-parts-empty">{t("parts.noUsedPartsRecorded")}</p> : null}
        {partsEditable ? <WorkorderPartsActions className="used-parts-actions">
          <Button id="workorder-add-approved-part" type="button" className="create-parts-compact-action" variant="secondary" icon={Plus} onClick={focusIntakeRow} aria-expanded={intakeOpen} aria-controls="workorder-part-intake-row">
            {t("parts.addPart")}
          </Button>
        </WorkorderPartsActions> : null}
        {!intakeOpen ? serializedDialog : null}
        {serializedHistory}
        <div className="used-parts-feedback" aria-live="polite">
          {message ? <span>{message}</span> : <span></span>}
        </div>
      </section>
      {canViewPrices && !financialFooter?.hidden ? <WorkorderPricingSummary pricing={financialFooter ? null : pricingForDisplay} {...financialFooter} /> : null}
      {measuredDialog}
      {removalDialog}
    </div>
  );
}
