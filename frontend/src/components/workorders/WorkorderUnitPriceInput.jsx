import { useEffect, useRef, useState } from "react";
import { formatWorkorderUnitPrice } from "./workorder-pricing-model.js";

export function WorkorderUnitPriceInput({ label, price, disabled, onCommit }) {
  const value = price?.selection ? formatWorkorderUnitPrice(price.unitPrice) : "";
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  const saving = useRef(false);
  useEffect(() => { setDraft(value); setError(""); }, [value, price?.id]);

  async function save() {
    if (disabled || !price?.selection || saving.current || draft === value) return;
    if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/.test(draft)) {
      setError("Enter a nonnegative price with up to four decimal places.");
      return;
    }
    if (Number(draft) === Number(value)) { setDraft(value); return; }
    saving.current = true;
    setError("");
    try { await onCommit(draft); setDraft(formatWorkorderUnitPrice(draft)); }
    finally { saving.current = false; }
  }

  return <>
    <input aria-label={label} aria-invalid={Boolean(error)} inputMode="decimal"
      readOnly={disabled || !price?.selection} placeholder="Price" value={draft}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => { setDraft(event.target.value); setError(""); }}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === "Escape") { event.preventDefault(); setDraft(value); setError(""); }
      }} />
    {error ? <small role="alert">{error}</small> : null}
  </>;
}
