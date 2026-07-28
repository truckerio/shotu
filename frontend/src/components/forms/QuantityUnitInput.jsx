import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, SearchMd } from "@untitledui/icons";
import {
  quantityInputModel,
  normalizeQuantityInput,
  unitOptionGroups,
} from "./quantity-unit-model.js";
import "./quantity-unit-input.css";

export function QuantityUnitInput({
  quantity,
  uomCode,
  onQuantityChange,
  onUomCodeChange,
  onValueChange,
  quantityLabel = "Quantity",
  unitLabel = "Unit",
  disabled = false,
  unitReadOnly = false,
  compact = false,
  max,
  id,
}) {
  const generatedId = useId();
  const inputId = id || `quantity-${generatedId}`;
  const listboxId = `${inputId}-units`;
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const model = quantityInputModel(quantity, uomCode);
  const groups = useMemo(() => unitOptionGroups(query), [query]);

  useEffect(() => {
    if (!open) return undefined;
    searchRef.current?.focus();
    function closeOnOutsidePointer(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function commitQuantity() {
    if (model.quantity === "") return;
    const normalized = normalizeQuantityInput(model.quantity, model.code);
    if (normalized && normalized !== model.quantity) {
      if (onValueChange) onValueChange({ quantity: normalized, uomCode: model.code });
      else onQuantityChange(normalized);
    }
  }

  function selectUnit(nextCode) {
    if (onValueChange) onValueChange({ quantity: model.quantity, uomCode: nextCode });
    else onUomCodeChange(nextCode);
    setOpen(false);
    setQuery("");
  }

  return (
    <div
      className={`quantity-unit-input ${compact ? "is-compact" : ""}`}
      ref={rootRef}
    >
      <label className="quantity-unit-number" htmlFor={inputId}>
        <span>{quantityLabel}</span>
        <input
          id={inputId}
          type="number"
          min={model.step}
          max={max}
          step={model.step}
          inputMode={model.decimalScale ? "decimal" : "numeric"}
          value={model.quantity}
          onChange={(event) => {
            const value = event.target.value;
            if (onValueChange) onValueChange({ quantity: value, uomCode: model.code });
            else onQuantityChange(value);
          }}
          onBlur={commitQuantity}
          placeholder="Qty"
          aria-label={quantityLabel}
          disabled={disabled}
        />
      </label>
      <div className="quantity-unit-picker">
        <span>{unitLabel}</span>
        <button
          type="button"
          className="quantity-unit-trigger"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-label={`${unitLabel}: ${model.symbol}`}
          disabled={disabled || unitReadOnly}
          onClick={() => setOpen((current) => !current)}
        >
          <strong>{model.symbol}</strong>
          {!unitReadOnly ? <ChevronDown aria-hidden="true" /> : null}
        </button>
        {open ? (
          <div className="quantity-unit-menu">
            <label className="quantity-unit-search">
              <SearchMd aria-hidden="true" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search units"
                aria-label="Search units"
              />
            </label>
            <div id={listboxId} className="quantity-unit-options" role="listbox" aria-label="Units of measure">
              {groups.length ? groups.map((group) => (
                <section key={group.category}>
                  <strong>{group.label}</strong>
                  <div>
                    {group.units.map((unit) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={unit.code === model.code}
                        className={unit.code === model.code ? "is-selected" : ""}
                        onClick={() => selectUnit(unit.code)}
                        key={unit.code}
                      >
                        <span>{unit.label}</span>
                        <small>{unit.symbol}</small>
                      </button>
                    ))}
                  </div>
                </section>
              )) : <p>No units found.</p>}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
