import { useEffect, useId, useRef, useState } from "react";
import { api } from "../../../lib/api.js";
import { textEntryProps } from "../../forms/text-entry-policy.js";
import {
  catalogInventoryText,
  catalogPartDetails,
  normalizeCatalogResponse,
} from "./catalog-parts-model.js";
import "./part-catalog-combobox.css";

const MIN_QUERY_LENGTH = 2;
const SEARCH_DELAY_MS = 250;

export function PartCatalogCombobox({
  workorderId,
  locationId,
  value,
  onChange,
  onSelect,
  disabled = false,
  label = "Part number or description",
  placeholder = "Part number or description",
  inputAriaLabel,
  inputPolicy = "search",
  allowAiFallback = false,
}) {
  const reactId = useId();
  const inputId = `part-catalog-input-${reactId}`;
  const listboxId = `part-catalog-list-${reactId}`;
  const rootRef = useRef(null);
  const optionRefs = useRef([]);
  const requestSequence = useRef(0);
  const selectedQueryRef = useRef("");
  const [state, setState] = useState("idle");
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const query = String(value || "");
  const normalizedQuery = query.trim();

  useEffect(() => {
    function closeFromOutside(event) {
      if (!rootRef.current?.contains(event.target)) {
        setInteracting(false);
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, []);

  useEffect(() => {
    setInteracting(false);
    setOpen(false);
    setItems([]);
    setState("idle");
    selectedQueryRef.current = "";
  }, [locationId, workorderId]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    setActiveIndex(-1);

    if (!interacting || disabled || (!workorderId && !locationId) || normalizedQuery.length < MIN_QUERY_LENGTH
      || selectedQueryRef.current === normalizedQuery) {
      setItems([]);
      setState("idle");
      return () => controller.abort();
    }

    setState("waiting");
    setItems([]);
    const timer = window.setTimeout(async () => {
      setState("loading");
      try {
        const params = new URLSearchParams({
          ...(workorderId ? { workorderId } : { locationId }),
          q: normalizedQuery,
          limit: "8",
        });
        const payload = await api(`/api/parts-helper/catalog?${params}`, { signal: controller.signal });
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        const result = normalizeCatalogResponse(payload);
        setItems(result.items);
        setState(!result.catalogAvailable ? "empty" : result.items.length ? "results" : "no-match");
        setOpen(true);
      } catch {
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        setItems([]);
        setState("error");
        setOpen(true);
      }
    }, SEARCH_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [disabled, interacting, locationId, normalizedQuery, workorderId]);

  function select(part) {
    selectedQueryRef.current = part.partNumber.trim();
    onSelect(part);
    setInteracting(false);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      // The desktop tools pane also listens for Escape. Keep this nested
      // combobox dismissal local so closing a dropdown never hides Chat or
      // Preview behind it.
      event.stopPropagation();
      setInteracting(false);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (event.key === "Tab") {
      setInteracting(false);
      setOpen(false);
      return;
    }
    if (state !== "results" || !items.length || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    if (event.key === "Enter") {
      if (open && activeIndex >= 0) {
        event.preventDefault();
        select(items[activeIndex]);
      }
      return;
    }
    event.preventDefault();
    setOpen(true);
    setActiveIndex((current) => {
      if (event.key === "ArrowDown") return current >= items.length - 1 ? 0 : current + 1;
      return current <= 0 ? items.length - 1 : current - 1;
    });
  }

  const showPopup = open && normalizedQuery.length >= MIN_QUERY_LENGTH
    && ["waiting", "loading", "results", "no-match", "empty", "error"].includes(state);
  const activeOptionId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <div className="part-catalog-field" ref={rootRef}>
      <label htmlFor={inputId}>{label}</label>
      <input
        {...textEntryProps(inputPolicy)}
        id={inputId}
        role="combobox"
        aria-label={inputAriaLabel}
        aria-autocomplete="list"
        aria-expanded={showPopup}
        aria-controls={showPopup ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
        autoComplete="off"
        value={query}
        onChange={(event) => {
          selectedQueryRef.current = "";
          setInteracting(true);
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setInteracting(true);
          if (normalizedQuery.length >= MIN_QUERY_LENGTH && selectedQueryRef.current !== normalizedQuery) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
      />
      {showPopup ? (
        <div className="part-catalog-popup" id={listboxId} role="listbox" aria-label="Company parts">
          {state === "results" ? (
            <ul role="presentation">
              {items.map((part, index) => (
                <li
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={activeIndex === index}
                  className={activeIndex === index ? "is-active" : ""}
                  key={part.id}
                  ref={(element) => { optionRefs.current[index] = element; }}
                  onClick={() => select(part)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="part-catalog-option-heading">
                    <strong>{part.partNumber}</strong>
                    <small>{part.source === "odoo" ? "Odoo" : "Company"}</small>
                  </span>
                  <span>{catalogPartDetails(part)}</span>
                  <small>{catalogInventoryText(part)}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="part-catalog-state" role="status">
              {state === "waiting" || state === "loading"
                ? "Searching company parts…"
                : state === "empty"
                  ? "No company parts imported. Ask an administrator to sync Odoo parts."
                  : state === "error"
                    ? "Parts lookup unavailable. Manual entry still works."
                    : allowAiFallback
                      ? "No catalog match. Continue manually or use Find."
                      : "No catalog match. Continue manually."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
