import { useEffect, useId, useRef, useState } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { api } from "../../../lib/api.js";
import { interfaceText } from "../../../i18n/index.js";
import { formatQuantityUnit } from "../../forms/quantity-unit-model.js";
import { Button } from "../../ui/Button.jsx";
import { PartRowActions } from "../PartRowActions.jsx";
import { WorkorderPartsRow } from "../WorkorderPartsTable.jsx";
import { PartRepairOrderField } from "./PartRepairOrderField.jsx";
import { StockIntakeControl } from "../../inventory/StockIntakeControl.jsx";
import { stockIntakeQuantity } from "../../inventory/stock-intake-model.js";
import { repairOrderAfterCatalogSelection } from "./catalog-parts-model.js";
import "./measured-part-usage.css";
import { workorderPartErrorMessage } from "../mechanic-part-request-model.js";
import { WorkorderPartPriceCell } from "../WorkorderPartPriceCell.jsx";
import { Dropdown } from "../../forms/Dropdown.jsx";
import { formatPriceAmount, knownPriceOption, missingPriceLabel, PART_PRICE_SOURCES } from "./workorder-serialized-part-selection.js";
import { canInstallQuantityUsage } from "./aggregate-install-model.js";

const transientKeys = new Map();

function requestKey(prefix, identity) {
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}-${crypto.randomUUID()}`;
}

function sessionKey(prefix, identity) {
  return `${prefix}:${identity}`;
}

function persistedKey(prefix, identity) {
  const storage = sessionKey(prefix, identity);
  if (transientKeys.has(storage)) return transientKeys.get(storage);
  try {
    const existing = window.sessionStorage.getItem(storage);
    if (existing) { transientKeys.set(storage, existing); return existing; }
    const next = requestKey(prefix, identity);
    window.sessionStorage.setItem(storage, next);
    transientKeys.set(storage, next);
    return next;
  } catch {
    const next = requestKey(prefix, identity);
    transientKeys.set(storage, next);
    return next;
  }
}

function clearPersistedKey(prefix, identity) {
  transientKeys.delete(sessionKey(prefix, identity));
  try { window.sessionStorage.removeItem(sessionKey(prefix, identity)); } catch { /* retry key remains in memory only */ }
}

function statusText(status, t) {
  const key = `parts.aggregateStatus.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

export function MeasuredPartUsageDialog({
  open,
  actorId,
  workorderId,
  catalogPart,
  locationId,
  assetId,
  suggestionsEnabled = true,
  allowStockIntake = true,
  canViewPrices = false,
  locale = "en",
  onClose,
  onReserved,
}) {
  const t = (key) => interfaceText(locale, key);
  const [quantity, setQuantity] = useState("1");
  const [repairOrder, setRepairOrder] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState(false);
  const [positions, setPositions] = useState([]);
  const [sourcePositionId, setSourcePositionId] = useState("");
  const [pricingPreview, setPricingPreview] = useState(null);
  const [priceSelection, setPriceSelection] = useState("");
  const [pricingLoading, setPricingLoading] = useState(false);
  const quantityRef = useRef(null);
  const pricingRequestRef = useRef(0);
  const titleId = useId();
  const uomCode = catalogPart?.canonicalUomCode || catalogPart?.uomCode || "";
  const amount = stockIntakeQuantity(quantity, catalogPart);

  useEffect(() => {
    if (!open) return;
    setQuantity("1"); setRepairOrder(repairOrderAfterCatalogSelection("", catalogPart)); setMessage(""); setCompleted(false); setPositions([]); setSourcePositionId(""); setPricingPreview(null); setPriceSelection("");
    let active = true;
    api(`/api/workorders/${encodeURIComponent(workorderId)}/modules/parts/actions/record`, {
      method: "POST",
      body: JSON.stringify({ operation: "aggregateUsagePositions", catalogPartId: catalogPart.id }),
    })
      .then((result) => { if (active) setPositions((result.result?.positions || []).filter((position) => position.isActive && position.canStore && position.isPickable && Number(position.available) > 0)); })
      .catch((error) => { if (active) setMessage(error?.message || t("parts.aggregateSaveFailed")); });
    window.requestAnimationFrame(() => quantityRef.current?.focus());
    return () => { active = false; };
  }, [open, catalogPart?.id, locationId, workorderId]);

  useEffect(() => {
    if (!open || !canViewPrices || !sourcePositionId || !amount.valid) {
      setPricingPreview(null);
      setPricingLoading(false);
      return undefined;
    }
    const requestId = ++pricingRequestRef.current;
    let active = true;
    setPricingLoading(true);
    setMessage("");
    api(`/api/workorders/${encodeURIComponent(workorderId)}/modules/parts/actions/record`, {
      method: "POST",
      body: JSON.stringify({
        operation: "partPricingPreview",
        usageKind: "aggregate",
        catalogPartId: catalogPart.id,
        sourcePositionId,
        quantity: Number(quantity),
        uomCode,
      }),
    }).then((result) => {
      if (active && requestId === pricingRequestRef.current) setPricingPreview(result.result || null);
    }).catch((error) => {
      if (!active || requestId !== pricingRequestRef.current) return;
      setPricingPreview(null);
      setMessage(error?.message || t("parts.aggregateSaveFailed"));
    }).finally(() => {
      if (active && requestId === pricingRequestRef.current) setPricingLoading(false);
    });
    return () => { active = false; };
  }, [open, canViewPrices, sourcePositionId, quantity, uomCode, workorderId, catalogPart?.id, amount.valid]);

  async function reserve(event) {
    event.preventDefault();
    const amount = Number(quantity);
    if (busy || completed || !stockIntakeQuantity(quantity, catalogPart).valid || !sourcePositionId) { setMessage(t("parts.measuredQuantityRequired")); return; }
    const selectedPrice = canViewPrices ? knownPriceOption(pricingPreview?.options, priceSelection) : null;
    if (canViewPrices && (!selectedPrice || !pricingPreview?.fingerprint)) {
      setMessage("Choose a price source with a known amount before adding this part.");
      return;
    }
    const identity = [actorId || "session", workorderId, catalogPart?.id, sourcePositionId, amount, uomCode, repairOrder.trim()].join(":");
    setBusy(true); setMessage("");
    try {
      const result = await api(`/api/workorders/${encodeURIComponent(workorderId)}/modules/parts/actions/record`, {
        method: "POST",
        body: JSON.stringify({
          operation: "aggregateUsageReserve",
          catalogPartId: catalogPart.id,
          sourcePositionId,
          quantity: amount,
          uomCode,
          repairOrder: repairOrder.trim(),
          idempotencyKey: persistedKey("aggregate-reserve", identity),
          ...(canViewPrices ? {
            pricing: {
              selection: priceSelection,
              expectedFingerprint: pricingPreview.fingerprint,
              reason: "Selected before adding quantity inventory to workorder",
            },
          } : {}),
        }),
      });
      clearPersistedKey("aggregate-reserve", identity);
      setCompleted(true);
      try {
        await onReserved?.(result.usage, result);
        onClose?.();
      } catch {
        setMessage(t("parts.aggregateReservedRefresh"));
      }
    } catch (error) {
      if (error?.code === "WORKORDER_PRICING_CHANGED") {
        setPricingPreview(null);
        setPriceSelection("");
        setSourcePositionId("");
      }
      setMessage(workorderPartErrorMessage(error, t) || t("parts.aggregateSaveFailed"));
    } finally { setBusy(false); }
  }

  if (!open) return null;
  const selectedPrice = canViewPrices ? knownPriceOption(pricingPreview?.options, priceSelection) : null;
  const priceOptions = PART_PRICE_SOURCES.map((source) => {
    const option = knownPriceOption(pricingPreview?.options, source.value);
    return {
      ...source,
      disabled: !option,
      amount: option ? formatPriceAmount(option.price, locale) : missingPriceLabel(source.value),
    };
  });
  return <ModalOverlay className="measured-part-dialog-overlay" isOpen isDismissable={false}>
    <Modal className="measured-part-dialog-modal">
      <Dialog className="measured-part-dialog" aria-labelledby={titleId} onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); onClose?.(); } }}>
        <header><div><p>{catalogPart?.trackingMode === "quantity" ? t("parts.quantity") : t("parts.measuredMaterial")}</p><h2 id={titleId}>{catalogPart?.partNumber}</h2><span>{catalogPart?.description}</span></div><button type="button" onClick={onClose} disabled={busy} aria-label={t("parts.closeMeasuredDialog")}>×</button></header>
        {allowStockIntake ? <StockIntakeControl catalogPartId={catalogPart?.id} locationId={locationId} onReceived={() => setMessage("Stock added. Enter the quantity to reserve for this workorder.")} /> : null}
        <form onSubmit={reserve}>
          {message ? <p className="measured-part-message" role="alert">{message}</p> : null}
          <label>{t("parts.quantity")}<input ref={quantityRef} type="number" min={amount.step} step={amount.step} max={amount.max} value={quantity} onChange={(event) => { setQuantity(event.target.value); setSourcePositionId(""); }} disabled={busy} /></label>
          <p>{uomCode}</p>
          <fieldset className="measured-part-positions"><legend>Pick from</legend>{positions.map((position) => {
            const disabled = Number(position.available) < Number(quantity || 0);
            return <label className={disabled ? "is-disabled" : ""} key={position.id}><input type="radio" name={`${titleId}-source-position`} checked={sourcePositionId === position.id} disabled={busy || disabled} onChange={() => setSourcePositionId(position.id)} /><span><strong>{position.path}</strong><small>{position.available} {uomCode}</small></span></label>;
          })}</fieldset>
          {canViewPrices ? <label className="measured-part-price-source">Price source<Dropdown aria-label="Price source" disabled={busy || pricingLoading || !sourcePositionId} value={priceSelection} onChange={(event) => setPriceSelection(event.target.value)} popoverClassName="measured-part-price-popover" showSelectionIndicator={false}>
            <option value="" disabled data-description={pricingLoading ? "Loading…" : "Required"}>Choose price source</option>
            {priceOptions.map((option) => <option key={option.value} value={option.value} disabled={option.disabled} data-description={option.amount}>{option.label}</option>)}
          </Dropdown></label> : null}
          <div className="measured-part-field"><label htmlFor={`${titleId}-repair-order`}>{t("parts.repairOrder")}</label><PartRepairOrderField
            historyEnabled={suggestionsEnabled}
            workorderId={workorderId}
            catalogPartId={catalogPart?.id}
            partNumber={catalogPart?.partNumber}
            assetId={assetId}
            currentRepairOrder={repairOrder}
            onApply={setRepairOrder}
            disabled={busy}
            locale={locale}
          ><textarea id={`${titleId}-repair-order`} value={repairOrder} onChange={(event) => setRepairOrder(event.target.value)} maxLength="2000" disabled={busy} /></PartRepairOrderField></div>
          <footer><Button type="button" onClick={onClose} disabled={busy}>{completed ? t("parts.close") : t("parts.cancel")}</Button><Button type="submit" variant="primary" disabled={busy || pricingLoading || completed || !amount.valid || !sourcePositionId || (canViewPrices && !selectedPrice)}>{busy ? t("parts.reserving") : t("parts.reserveMeasured")}</Button></footer>
        </form>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}

export function AggregatePartUsageRows({ actorId, workorderId, usages, role, editable, showPrice = false, compact = false, locale = "en", onChanged, startOrdinal = 1 }) {
  const t = (key) => interfaceText(locale, key);
  const [editing, setEditing] = useState(null);
  const [reason, setReason] = useState("");
  const [targetQuantity, setTargetQuantity] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canOfficeCorrect = ["office", "admin"].includes(role);
  if (!Array.isArray(usages) || !usages.length) return null;

  function openLifecycle(usage, action) {
    setEditing({ usage, action }); setReason(""); setTargetQuantity(String(usage.effectiveQuantity)); setMessage("");
  }
  async function install(usage) {
    if (busy || !canInstallQuantityUsage(usage, editable)) return;
    const identity = [actorId || "session", workorderId, usage.id, "install"].join(":");
    setBusy(true); setMessage("");
    try {
      await api(`/api/workorders/${encodeURIComponent(workorderId)}/modules/parts/actions/record`, {
        method: "POST",
        body: JSON.stringify({ operation: "aggregateUsageLifecycle", usageId: usage.id, action: "install",
          reason: "Marked installed in Workorder", idempotencyKey: persistedKey("aggregate-install", identity) }),
      });
      clearPersistedKey("aggregate-install", identity);
      try { await onChanged?.(); }
      catch { setMessage(t("parts.aggregateReservedRefresh")); }
    } catch (error) { setMessage(locale === "en" && error?.message ? error.message : t("parts.aggregateSaveFailed")); }
    finally { setBusy(false); }
  }
  async function submitLifecycle(event) {
    event.preventDefault();
    if (!reason.trim() || (editing.action === "adjust" && !(Number(targetQuantity) > 0))) return;
    const usage = editing.usage;
    const identity = [actorId || "session", workorderId, usage.id, editing.action, targetQuantity, reason.trim()].join(":");
    setBusy(true); setMessage("");
    try {
      await api(`/api/workorders/${encodeURIComponent(workorderId)}/modules/parts/actions/record`, {
        method: "POST",
        body: JSON.stringify({ operation: "aggregateUsageLifecycle", usageId: usage.id, action: editing.action, ...(editing.action === "adjust" ? { targetQuantity: Number(targetQuantity) } : {}), reason: reason.trim(), idempotencyKey: persistedKey("aggregate-lifecycle", identity) }),
      });
      clearPersistedKey("aggregate-lifecycle", identity);
      try {
        await onChanged?.(); setEditing(null);
      } catch { setEditing(null); setMessage(t("parts.aggregateReservedRefresh")); }
    } catch (error) { setMessage(locale === "en" && error?.message ? error.message : t("parts.aggregateSaveFailed")); }
    finally { setBusy(false); }
  }

  return <>
    {message && !editing ? <p className="measured-part-message" role="status">{message}</p> : null}
    {usages.map((usage, index) => {
      const releasable = editable && (usage.status === "reserved" || (usage.status === "installed_pending_approval" && usage.trackingMode === "measured_bulk"));
      const correctable = canOfficeCorrect && usage.status === "consumed";
      const status = statusText(usage.status, t);
      const pickupPath = usage.sourcePositionPath || (usage.status === "reserved" ? "Pickup not assigned" : "");
      return <WorkorderPartsRow key={usage.id} className="used-part-aggregate-row" aria-label={`${usage.partNumber}, ${formatQuantityUnit(usage.effectiveQuantity, usage.uomCode)}, ${status}`}>
        <strong>{startOrdinal + index}</strong>
        <div className="used-part-field used-part-aggregate-identity"><span className="used-part-cell-label">{t("parts.part")}</span><span className="used-part-name-field">{usage.partNumber}</span><small>{t("parts.evidenceRecorded")} · {usage.evidenceId}</small>{usage.status !== "reserved" ? <small className="used-part-row-status">{status}</small> : null}</div>
        <div className="used-part-field used-part-aggregate-value"><span className="used-part-cell-label">{t("parts.quantityUnit")}</span><strong>{formatQuantityUnit(usage.effectiveQuantity, usage.uomCode)}</strong></div>
        <div className="used-part-field used-part-aggregate-repair"><span className="used-part-cell-label">{t("parts.repairOrder")}</span>{canInstallQuantityUsage(usage, editable)
          ? <Button type="button" className="used-part-install" onClick={() => install(usage)} disabled={busy}>{t("parts.markInstalled")}</Button>
          : usage.repairOrder || <span aria-hidden="true">—</span>}</div>
        {!compact ? (pickupPath ? <div className="used-part-field used-part-aggregate-pickup"><span className="used-part-cell-label">Pickup</span><strong>{pickupPath}</strong></div> : <span className="used-part-pickup-empty" aria-hidden="true"></span>) : null}
        {showPrice ? <WorkorderPartPriceCell compact={compact} workorderId={workorderId} usageKind="aggregate" usageId={usage.id} price={usage.price} quantity={usage.effectiveQuantity} costAllocations={usage.costAllocations} onChanged={onChanged} disabled={!editable} /> : null}
        <div className="aggregate-part-actions">
          <PartRowActions label={`More actions for ${usage.partNumber}`} disabled={busy} actions={[
            releasable && { id: "release", label: t("parts.releaseMeasured"), onAction: () => openLifecycle(usage, "release") },
            correctable && { id: "reverse", label: t("parts.reverseMeasured"), onAction: () => openLifecycle(usage, "reverse") },
            correctable && { id: "adjust", label: t("parts.adjustMeasured"), onAction: () => openLifecycle(usage, "adjust") },
          ]} />
        </div>
      </WorkorderPartsRow>;
    })}
    {editing ? <ModalOverlay className="measured-part-dialog-overlay" isOpen isDismissable={false}><Modal className="measured-part-dialog-modal"><Dialog className="measured-part-dialog" aria-label={t("parts.correctMeasuredUsage")}><form onSubmit={submitLifecycle}><h2>{editing.action === "adjust" ? t("parts.adjustMeasured") : editing.action === "reverse" ? t("parts.reverseMeasured") : t("parts.releaseMeasured")}</h2>{message ? <p className="measured-part-message" role="alert">{message}</p> : null}{editing.action === "adjust" ? <label>{t("parts.quantity")}<input type="number" min="0.001" step="0.001" value={targetQuantity} onChange={(event) => setTargetQuantity(event.target.value)} disabled={busy} /></label> : null}<label>{t("parts.reasonRequired")}<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength="2" maxLength="500" required disabled={busy} /></label><footer><Button type="button" onClick={() => setEditing(null)} disabled={busy}>{t("parts.cancel")}</Button><Button type="submit" variant="primary" disabled={busy || !reason.trim() || (editing.action === "adjust" && !(Number(targetQuantity) > 0))}>{t("parts.save")}</Button></footer></form></Dialog></Modal></ModalOverlay> : null}
    </>;
}
