import { useEffect, useMemo, useState } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { CurrencySelector } from "../forms/CurrencySelector.jsx";
import { Dropdown } from "../forms/Dropdown.jsx";
import { Button } from "../ui/Button.jsx";
import { availableRateKinds, rateDraft, rateDraftIsValid } from "./set-rates-model.js";
import "./set-rates-dialog.css";

const labels = { internal_cost: "Internal price", selling_price: "Selling price" };

export function SetRatesDialog({
  open,
  onClose,
  subjectLabel,
  uomCode,
  scopeLabel,
  initialKind = "selling_price",
  rates,
  allowedKinds,
  allowSellingMethods = false,
  onSave,
  disabled = false,
  loading = false,
  loadError = "",
  onRetry,
}) {
  const kinds = useMemo(() => availableRateKinds(allowedKinds), [allowedKinds]);
  const firstKind = kinds.includes(initialKind) ? initialKind : kinds[0] || initialKind;
  const [kind, setKind] = useState(firstKind);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("fixed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const selected = kinds.includes(initialKind) ? initialKind : kinds[0] || initialKind;
    const draft = rateDraft(rates, selected);
    setKind(selected);
    setAmount(draft.amount);
    setCurrency(draft.currency);
    setMethod(allowSellingMethods ? draft.method : "fixed");
    setReason("");
    setBusy(false);
    setError("");
  }, [open, initialKind, kinds.join("|"), rates, allowSellingMethods]);

  function selectKind(nextKind) {
    const draft = rateDraft(rates, nextKind);
    setKind(nextKind);
    setAmount(draft.amount);
    setCurrency(draft.currency);
    setMethod(nextKind === "selling_price" && allowSellingMethods ? draft.method : "fixed");
    setReason("");
    setError("");
  }

  const effectiveMethod = kind === "selling_price" ? method : "fixed";
  const needsCurrency = effectiveMethod !== "markup_percent";
  const valid = rateDraftIsValid({ kind, amount, currency, reason, method: effectiveMethod });

  async function submit(event) {
    event.preventDefault();
    if (!valid || busy || disabled || loading || loadError) return;
    setBusy(true);
    setError("");
    try {
      await onSave({
        kind,
        amount: String(amount).trim(),
        currency: needsCurrency ? currency : null,
        reason: reason.trim(),
        method: effectiveMethod,
      });
      onClose?.();
    } catch (failure) {
      setError(failure.message || "Rates could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const current = rates?.[kind];
  return <ModalOverlay className="set-rates-overlay" isOpen={open} isDismissable={!busy} onOpenChange={(isOpen) => { if (!isOpen && !busy) onClose?.(); }}>
    <Modal className="set-rates-modal">
      <Dialog className="set-rates-dialog" aria-label="Set rates">
        <Heading slot="title">Set rates</Heading>
        <p className="set-rates-subject">{subjectLabel || "Item"}{uomCode ? ` · per ${uomCode}` : ""}</p>
        {scopeLabel ? <p className="set-rates-scope">{scopeLabel}</p> : null}
        {loading ? <p role="status">Loading rates…</p> : null}
        {loadError ? <div className="set-rates-error" role="alert"><p>{loadError}</p>{onRetry ? <Button type="button" onClick={onRetry}>Retry</Button> : null}</div> : null}
        {!loading && !loadError && !kinds.length ? <p className="set-rates-error" role="alert">You do not have permission to change rates in this scope.</p> : null}
        {!loading && !loadError && kinds.length ? <form onSubmit={submit}>
          <label><span>Rate type</span><Dropdown aria-label="Rate type" value={kind} onChange={(event) => selectKind(event.target.value)} disabled={busy || disabled || kinds.length === 1}>{kinds.map((value) => <option value={value} key={value}>{labels[value]}</option>)}</Dropdown></label>
          {current?.sourceLabel ? <p className="set-rates-source">{current.sourceLabel}</p> : null}
          {kind === "selling_price" && allowSellingMethods ? <label><span>Method</span><Dropdown aria-label="Method" value={method} onChange={(event) => setMethod(event.target.value)} disabled={busy || disabled}><option value="fixed">Same price for every batch</option><option value="markup_percent">Markup % on batch cost</option><option value="markup_amount">Add amount to batch cost</option></Dropdown></label> : null}
          <label><span>{effectiveMethod === "markup_percent" ? "Markup %" : "Amount"}</span><input autoFocus inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={kind === "internal_cost" ? "Unknown" : "0.00"} disabled={busy || disabled} /></label>
          {needsCurrency ? <label><span>Currency</span><CurrencySelector value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={busy || disabled} /></label> : <p className="set-rates-help">Uses each batch currency.</p>}
          <label className="set-rates-reason"><span>Reason</span><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Why is this rate changing?" disabled={busy || disabled} /></label>
          {error ? <p className="set-rates-error" role="alert">{error}</p> : null}
          <footer><Button type="button" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" disabled={!valid || busy || disabled}>{busy ? "Saving…" : "Save"}</Button></footer>
        </form> : null}
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
