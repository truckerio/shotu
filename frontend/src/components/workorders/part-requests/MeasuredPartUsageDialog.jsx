import { useEffect, useId, useRef, useState } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { api } from "../../../lib/api.js";
import { interfaceText } from "../../../i18n/index.js";
import { formatQuantityUnit } from "../../forms/quantity-unit-model.js";
import { Button } from "../../ui/Button.jsx";
import "./measured-part-usage.css";

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

export function MeasuredPartUsageDialog({ open, actorId, workorderId, catalogPart, locale = "en", onClose, onReserved }) {
  const t = (key) => interfaceText(locale, key);
  const [quantity, setQuantity] = useState("1");
  const [repairOrder, setRepairOrder] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState(false);
  const quantityRef = useRef(null);
  const titleId = useId();
  const uomCode = catalogPart?.uomCode || "";

  useEffect(() => {
    if (!open) return;
    setQuantity("1"); setRepairOrder(""); setMessage(""); setCompleted(false);
    window.requestAnimationFrame(() => quantityRef.current?.focus());
  }, [open, catalogPart?.id]);

  async function reserve(event) {
    event.preventDefault();
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount <= 0) { setMessage(t("parts.measuredQuantityRequired")); return; }
    const identity = [actorId || "session", workorderId, catalogPart?.id, amount, uomCode, repairOrder.trim()].join(":");
    setBusy(true); setMessage("");
    try {
      const result = await api(`/api/workorders/${encodeURIComponent(workorderId)}/modules/parts/actions/record`, {
        method: "POST",
        body: JSON.stringify({ operation: "aggregateUsageReserve", catalogPartId: catalogPart.id, quantity: amount, uomCode, repairOrder: repairOrder.trim(), idempotencyKey: persistedKey("aggregate-reserve", identity) }),
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
      setMessage(locale === "en" && error?.message ? error.message : t("parts.aggregateSaveFailed"));
    } finally { setBusy(false); }
  }

  if (!open) return null;
  return <ModalOverlay className="measured-part-dialog-overlay" isOpen isDismissable={false}>
    <Modal className="measured-part-dialog-modal">
      <Dialog className="measured-part-dialog" aria-labelledby={titleId} onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); onClose?.(); } }}>
        <header><div><p>{t("parts.measuredMaterial")}</p><h2 id={titleId}>{catalogPart?.partNumber}</h2><span>{catalogPart?.description}</span></div><button type="button" onClick={onClose} disabled={busy} aria-label={t("parts.closeMeasuredDialog")}>×</button></header>
        <form onSubmit={reserve}>
          {message ? <p className="measured-part-message" role="alert">{message}</p> : null}
          <label>{t("parts.quantity")}<input ref={quantityRef} type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={busy} /></label>
          <p>{uomCode}</p>
          <label>{t("parts.repairOrder")}<textarea value={repairOrder} onChange={(event) => setRepairOrder(event.target.value)} maxLength="2000" disabled={busy} /></label>
          <footer><Button type="button" onClick={onClose} disabled={busy}>{completed ? t("parts.close") : t("parts.cancel")}</Button><Button type="submit" variant="primary" disabled={busy || completed}>{busy ? t("parts.reserving") : t("parts.reserveMeasured")}</Button></footer>
        </form>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}

export function AggregatePartUsageRows({ actorId, workorderId, usages, role, editable, locale = "en", onChanged }) {
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

  return <div className="aggregate-part-usages" aria-label={t("parts.measuredUsageEvidence")}>
    {message && !editing ? <p className="measured-part-message" role="status">{message}</p> : null}
    {usages.map((usage) => {
      const releasable = editable && ["reserved", "installed_pending_approval"].includes(usage.status);
      const correctable = canOfficeCorrect && usage.status === "consumed";
      return <article key={usage.id} className="part-row used-part-aggregate-row">
        <div><strong>{usage.partNumber}</strong><span>{formatQuantityUnit(usage.effectiveQuantity, usage.uomCode)}</span><small>{statusText(usage.status, t)} · {t("parts.evidenceRecorded")} · {usage.evidenceId}</small>{usage.repairOrder ? <span>{usage.repairOrder}</span> : null}</div>
        <div className="aggregate-part-actions">
          {releasable ? <Button type="button" onClick={() => openLifecycle(usage, "release")}>{t("parts.releaseMeasured")}</Button> : null}
          {correctable ? <><Button type="button" onClick={() => openLifecycle(usage, "reverse")}>{t("parts.reverseMeasured")}</Button><Button type="button" onClick={() => openLifecycle(usage, "adjust")}>{t("parts.adjustMeasured")}</Button></> : null}
        </div>
      </article>;
    })}
    {editing ? <ModalOverlay className="measured-part-dialog-overlay" isOpen isDismissable={false}><Modal className="measured-part-dialog-modal"><Dialog className="measured-part-dialog" aria-label={t("parts.correctMeasuredUsage")}><form onSubmit={submitLifecycle}><h2>{editing.action === "adjust" ? t("parts.adjustMeasured") : editing.action === "reverse" ? t("parts.reverseMeasured") : t("parts.releaseMeasured")}</h2>{message ? <p className="measured-part-message" role="alert">{message}</p> : null}{editing.action === "adjust" ? <label>{t("parts.quantity")}<input type="number" min="0.001" step="0.001" value={targetQuantity} onChange={(event) => setTargetQuantity(event.target.value)} disabled={busy} /></label> : null}<label>{t("parts.reasonRequired")}<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength="2" maxLength="500" required disabled={busy} /></label><footer><Button type="button" onClick={() => setEditing(null)} disabled={busy}>{t("parts.cancel")}</Button><Button type="submit" variant="primary" disabled={busy || !reason.trim() || (editing.action === "adjust" && !(Number(targetQuantity) > 0))}>{t("parts.save")}</Button></footer></form></Dialog></Modal></ModalOverlay> : null}
    </div>;
}
