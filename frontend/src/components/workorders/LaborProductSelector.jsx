import { useEffect, useId, useRef, useState } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { api } from "../../lib/api.js";
import {
  createLaborProductPayload,
  laborProductLabel,
  localLaborProductValue,
  normalizeLaborProductItem,
  normalizeLaborProductsResponse,
  orderedLaborProducts,
  productMatchesValue,
} from "./labor-product-selector-model.js";
import "./labor-product-selector.css";

function CreateLaborProductDialog({ locationId, onClose, onCreated }) {
  const titleId = useId();
  const nameId = useId();
  const codeId = useId();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function submit(event) {
    event.preventDefault();
    event.stopPropagation();
    if (busyRef.current) return;
    const body = createLaborProductPayload({ locationId, name, code });
    if (!body) {
      setError("Enter a labor product name.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/labor-products", { method: "POST", body: JSON.stringify(body) });
      const product = normalizeLaborProductItem(result.item || result.product || result);
      if (!product.id || !product.name) throw new Error("Labor product could not be created.");
      await onCreated(product);
      onClose();
    } catch (nextError) {
      setError(nextError.message || "Labor product could not be created.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return <ModalOverlay className="labor-product-create-overlay" isOpen isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <Modal className="labor-product-create-modal">
      <Dialog className="labor-product-create-dialog" aria-labelledby={titleId}>
        <form noValidate onSubmit={submit}>
          <Heading slot="title" id={titleId}>Create labor product</Heading>
          <p>Available to this company for workorders. It uses hours.</p>
          {error ? <p role="alert" className="labor-product-error">{error}</p> : null}
          <label htmlFor={nameId}>Name<input id={nameId} autoFocus autoComplete="off" maxLength={300} value={name} disabled={busy} onChange={(event) => { setName(event.target.value); setError(""); }} /></label>
          <label htmlFor={codeId}>Code <span>(optional)</span><input id={codeId} autoComplete="off" maxLength={100} value={code} disabled={busy} onChange={(event) => { setCode(event.target.value); setError(""); }} /></label>
          <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy}>{busy ? "Creating…" : "Create product"}</button></footer>
        </form>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}

export function LaborProductSelector({ locationId = "", value = null, onChange, locale = "en", disabled = false }) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const optionRefs = useRef([]);
  const requestRef = useRef(0);
  const suppressNextInputOpenRef = useRef(false);
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [permissions, setPermissions] = useState({ canCreate: false, canPin: false });
  const [state, setState] = useState("idle");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [createOpen, setCreateOpen] = useState(false);
  const [pinError, setPinError] = useState("");
  const selectedLabel = laborProductLabel(value);
  const displayValue = open ? query : (value ? selectedLabel : "");
  const orderedItems = orderedLaborProducts(items);

  useEffect(() => {
    function closeFromOutside(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setActiveIndex(-1);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, []);

  useEffect(() => {
    const sequence = ++requestRef.current;
    const controller = new AbortController();
    if (!open || disabled || !locationId) {
      setItems([]);
      setState("idle");
      return () => controller.abort();
    }
    setState("loading");
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ locationId, ...(query.trim() ? { q: query.trim() } : {}) });
        const payload = await api(`/api/labor-products?${params}`, { signal: controller.signal });
        if (controller.signal.aborted || sequence !== requestRef.current) return;
        const result = normalizeLaborProductsResponse(payload);
        setItems(result.items);
        setPermissions({ canCreate: result.canCreate, canPin: result.canPin });
        setState(result.items.length ? "results" : "empty");
      } catch (error) {
        if (controller.signal.aborted || sequence !== requestRef.current) return;
        setItems([]);
        setState("error");
      }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [disabled, locationId, open, query]);

  useEffect(() => {
    setOpen(false); setQuery(""); setItems([]); setActiveIndex(-1); setState("idle");
  }, [locationId]);

  useEffect(() => {
    if (activeIndex >= 0) optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  function closeList() { setOpen(false); setActiveIndex(-1); setQuery(""); }
  function focusInputWithoutOpening() {
    suppressNextInputOpenRef.current = true;
    inputRef.current?.focus();
  }
  function select(item) { onChange?.(localLaborProductValue(item)); closeList(); focusInputWithoutOpening(); }

  async function togglePin(event, item) {
    event.stopPropagation();
    setPinError("");
    try {
      const result = await api(`/api/labor-products/${encodeURIComponent(item.id)}`, {
        method: "PATCH", body: JSON.stringify({ locationId, pinned: !item.pinned }),
      });
      const updated = normalizeLaborProductItem(result.item || result.product || result);
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...updated } : entry));
    } catch (error) {
      // Keep the existing result visible: a permission or network failure must not change selection.
      setPinError(error.message || "Pin could not be updated.");
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") { event.stopPropagation(); closeList(); return; }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      setActiveIndex((index) => index >= orderedItems.length - 1 ? 0 : index + 1);
    } else if (event.key === "ArrowUp" && open && orderedItems.length) {
      event.preventDefault(); setActiveIndex((index) => index <= 0 ? orderedItems.length - 1 : index - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        const activeProduct = orderedItems[activeIndex];
        if (activeProduct) select(activeProduct);
      }
    }
  }

  async function handleCreated(product) {
    setItems((current) => [product, ...current.filter((item) => item.id !== product.id)]);
    onChange?.(localLaborProductValue(product));
  }

  function closeCreateDialog() {
    setCreateOpen(false);
    window.requestAnimationFrame(focusInputWithoutOpening);
  }

  return <div className="labor-product-selector" ref={rootRef} data-locale={locale} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) closeList();
  }} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); closeList(); }
  }}>
    <label className="labor-product-visually-hidden" htmlFor={`${listboxId}-input`}>Labor product</label>
    <div className="labor-product-control">
      <input ref={inputRef} id={`${listboxId}-input`} type="search" aria-expanded={open} aria-controls={open ? listboxId : undefined} aria-label="Labor product" autoComplete="off" placeholder={locationId ? "Search labor products" : "Choose a location first"} value={displayValue} disabled={disabled || !locationId} onFocus={() => {
        if (suppressNextInputOpenRef.current) { suppressNextInputOpenRef.current = false; return; }
        setOpen(true); setQuery("");
      }} onClick={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(-1); }} onKeyDown={handleKeyDown} />
      <button type="button" className="labor-product-toggle" aria-label="Choose labor product" aria-expanded={open} aria-controls={listboxId} disabled={disabled || !locationId} onClick={() => {
        if (open) closeList();
        else { setOpen(true); setQuery(""); inputRef.current?.focus(); }
      }}><span aria-hidden="true">⌄</span></button>
      {value?.productId ? <button type="button" className="labor-product-clear" aria-label="Clear labor product" disabled={disabled} onClick={() => onChange?.(null)}>Clear</button> : null}
    </div>
    {open ? <div className="labor-product-popup" id={listboxId} aria-label="Local labor products">
      {state === "loading" ? <p role="status">Searching local labor products…</p> : null}
      {state === "error" ? <p role="alert">Labor products could not be loaded. Try again.</p> : null}
      {state === "empty" ? <p role="status">No local labor products match.</p> : null}
      {pinError ? <p role="alert">{pinError}</p> : null}
      {state === "results" ? <ul>{orderedItems.map((item, index) => <li key={item.id} id={`${listboxId}-option-${index}`} ref={(element) => { optionRefs.current[index] = element; }} className={activeIndex === index ? "is-active" : ""} onMouseEnter={() => setActiveIndex(index)}><button type="button" className="labor-product-select-option" aria-pressed={productMatchesValue(item, value)} onClick={() => select(item)}><span><strong>{laborProductLabel(item)}</strong>{item.pinned ? <small>Pinned</small> : null}</span></button>{permissions.canPin ? <button type="button" aria-label={`${item.pinned ? "Unpin" : "Pin"} ${laborProductLabel(item)}`} onClick={(event) => togglePin(event, item)}>{item.pinned ? "Unpin" : "Pin"}</button> : null}</li>)}</ul> : null}
      {permissions.canCreate ? <button type="button" className="labor-product-create-action" onClick={() => { closeList(); setCreateOpen(true); }}>Create labor product</button> : null}
    </div> : null}
    {createOpen ? <CreateLaborProductDialog locationId={locationId} onClose={closeCreateDialog} onCreated={handleCreated} /> : null}
  </div>;
}
