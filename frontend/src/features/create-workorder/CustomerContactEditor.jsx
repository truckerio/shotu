import { useEffect, useRef, useState } from "react";

const focusableSelector = "a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex='-1'])";

function initialValue(kind, value) {
  return kind === "customer"
    ? { name: value?.name || "", address: value?.address || "" }
    : { name: value?.name || "", email: value?.email || "", phone: value?.phone || "" };
}

export function CustomerContactEditor({ kind, open, value = null, busy = false, error = "", onClose, onSave }) {
  const [draft, setDraft] = useState(() => initialValue(kind, value));
  const dialogRef = useRef(null);
  useEffect(() => setDraft(initialValue(kind, value)), [kind, open, value]);
  useEffect(() => {
    if (!open) return undefined;
    const containKeyboardFocus = (event) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [...(dialogRef.current?.querySelectorAll(focusableSelector) || [])];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", containKeyboardFocus);
    return () => document.removeEventListener("keydown", containKeyboardFocus);
  }, [busy, onClose, open]);
  if (!open) return null;
  const title = `${value?.id ? "Edit" : "New"} ${kind}`;
  const save = (event) => { event.preventDefault(); onSave?.(draft); };
  return <div className="create-customer-editor-backdrop" role="presentation"><section ref={dialogRef} className="create-customer-editor" role="dialog" aria-modal="true" aria-labelledby="customer-editor-title"><form onSubmit={save}><div className="create-customer-editor-heading"><h2 id="customer-editor-title">{title}</h2><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Close</button></div><label>Name<input autoFocus required value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} autoComplete={kind === "customer" ? "organization" : "name"} /></label>{kind === "customer" ? <label>Address <span>(optional)</span><textarea rows="3" value={draft.address} onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))} autoComplete="street-address" /></label> : <><label>Email <span>(optional)</span><input type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} autoComplete="email" /></label><label>Phone <span>(optional)</span><input type="tel" value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} autoComplete="tel" /></label></>}{error ? <p role="alert">{error}</p> : null}<div className="create-customer-editor-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div></form></section></div>;
}
