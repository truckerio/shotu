import { useEffect, useId, useRef, useState } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { api } from "../../lib/api.js";
import { Dropdown, DropdownTrigger } from "../forms/Dropdown.jsx";
import {
  createLaborProductPayload,
  laborProductLabel,
  laborProviderPriceLabel,
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
  const descriptionId = useId();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [uomCode, setUomCode] = useState("hr");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function submit(event) {
    event.preventDefault();
    event.stopPropagation();
    if (busyRef.current) return;
    const body = createLaborProductPayload({ locationId, name, code, description, uomCode });
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
          <p>Available to this company for workorders.</p>
          {error ? <p role="alert" className="labor-product-error">{error}</p> : null}
          <label htmlFor={nameId}>Name<input id={nameId} autoFocus autoComplete="off" maxLength={300} value={name} disabled={busy} onChange={(event) => { setName(event.target.value); setError(""); }} /></label>
          <label htmlFor={codeId}>Code <span>(optional)</span><input id={codeId} autoComplete="off" maxLength={100} value={code} disabled={busy} onChange={(event) => { setCode(event.target.value); setError(""); }} /></label>
          <label htmlFor={descriptionId}>Description <span>(optional)</span><textarea id={descriptionId} maxLength={2000} rows={3} value={description} disabled={busy} onChange={(event) => setDescription(event.target.value)} /></label>
          <div className="labor-product-billing-unit"><span>Billing unit</span><Dropdown aria-label="Billing unit" value={uomCode} disabled={busy} onChange={(event) => setUomCode(event.target.value)}><option value="hr">Hourly</option><option value="ea">Flat service</option></Dropdown></div>
          <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy}>{busy ? "Creating…" : "Create product"}</button></footer>
        </form>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}

export function LaborProductSelector({ locationId = "", value = null, onChange, locale = "en", disabled = false, canViewPrices = false }) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const requestRef = useRef(0);
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
      if (disabled || !locationId) setOpen(false);
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

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  function closeList() { setOpen(false); setActiveIndex(-1); setQuery(""); }
  function focusTrigger() { triggerRef.current?.focus(); }
  function select(item) { if (disabled) return; onChange?.(localLaborProductValue(item)); closeList(); focusTrigger(); }

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
    if (event.key === "Escape") { event.stopPropagation(); closeList(); focusTrigger(); return; }
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
    window.requestAnimationFrame(focusTrigger);
  }

  return <div className="labor-product-selector" ref={rootRef} data-locale={locale} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) closeList();
  }} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); closeList(); focusTrigger(); }
  }}>
    <DropdownTrigger ref={triggerRef} type="button" className="labor-product-control labor-product-trigger" aria-label={value ? `Choose labor product: ${selectedLabel}` : "Choose labor product"} aria-expanded={open} aria-controls={open ? listboxId : undefined} disabled={disabled || !locationId} onKeyDown={handleKeyDown} onClick={() => {
      if (open) closeList();
      else { setOpen(true); setQuery(""); }
    }}>
      <span className="labor-product-value">{value ? selectedLabel : locationId ? "Select labor product" : "Choose a location first"}</span>
    </DropdownTrigger>
    {open ? <div className="labor-product-popup" id={listboxId} aria-label="Local labor products">
      <input ref={inputRef} className="labor-product-search" type="search" aria-label="Search labor products" autoComplete="off" placeholder="Search labor products" value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); }} onKeyDown={handleKeyDown} />
      {state === "loading" ? <p role="status">Searching local labor products…</p> : null}
      {state === "error" ? <p role="alert">Labor products could not be loaded. Try again.</p> : null}
      {state === "empty" ? <p role="status">No local labor products match.</p> : null}
      {pinError ? <p role="alert">{pinError}</p> : null}
      {state === "results" ? <ul>{orderedItems.map((item, index) => { const providerPrice = canViewPrices ? laborProviderPriceLabel(item) : ""; return <li key={item.id} id={`${listboxId}-option-${index}`} ref={(element) => { optionRefs.current[index] = element; }} className={activeIndex === index ? "is-active" : ""} onMouseEnter={() => setActiveIndex(index)}><button type="button" className="labor-product-select-option" aria-pressed={productMatchesValue(item, value)} onClick={() => select(item)}><span><strong>{laborProductLabel(item)}</strong>{providerPrice ? <small>{providerPrice}</small> : null}{item.pinned ? <small>Pinned</small> : null}</span></button>{permissions.canPin ? <button type="button" aria-label={`${item.pinned ? "Unpin" : "Pin"} ${laborProductLabel(item)}`} onClick={(event) => togglePin(event, item)}>{item.pinned ? "Unpin" : "Pin"}</button> : null}</li>; })}</ul> : null}
      {permissions.canCreate ? <button type="button" className="labor-product-create-action" onClick={() => { closeList(); setCreateOpen(true); }}>Create labor product</button> : null}
    </div> : null}
    {createOpen ? <CreateLaborProductDialog locationId={locationId} onClose={closeCreateDialog} onCreated={handleCreated} /> : null}
  </div>;
}
