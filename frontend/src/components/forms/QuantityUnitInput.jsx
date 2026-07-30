import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, SearchMd } from "@untitledui/icons";
import {
  quantityInputModel,
  normalizeQuantityInput,
  unitOptionGroups,
} from "./quantity-unit-model.js";
import { textEntryProps } from "./text-entry-policy.js";
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
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuPlacement, setMenuPlacement] = useState("below");
  const [menuStyle, setMenuStyle] = useState(undefined);
  const model = quantityInputModel(quantity, uomCode);
  const groups = useMemo(() => unitOptionGroups(query), [query]);

  useEffect(() => {
    if (!open) return undefined;
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

  useLayoutEffect(() => {
    if (!open) {
      setMenuPlacement("below");
      setMenuStyle(undefined);
      return undefined;
    }

    function positionMenu() {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;

      const gutter = 16;
      const gap = 6;
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const triggerRect = trigger.getBoundingClientRect();
      const availableBelow = viewportHeight - triggerRect.bottom - gap - gutter;
      const availableAbove = triggerRect.top - gap - gutter;
      const isMobile = window.matchMedia("(max-width: 700px)").matches;
      const menuHeight = Math.min(menu.scrollHeight, isMobile ? 420 : 360);
      const minimumUsefulHeight = isMobile ? 180 : 240;
      const openBelow = availableBelow >= Math.min(menuHeight, minimumUsefulHeight)
        || availableBelow >= availableAbove;
      setMenuPlacement(openBelow ? "below" : "above");

      const availableHeight = Math.max(160, openBelow ? availableBelow : availableAbove);
      const boundedHeight = Math.min(isMobile ? 420 : 360, availableHeight);
      const nextStyle = {
        "--quantity-menu-max-height": `${boundedHeight}px`,
      };
      if (!isMobile) {
        setMenuStyle(nextStyle);
        return;
      }

      const top = openBelow
        ? triggerRect.bottom + gap
        : Math.max(gutter, triggerRect.top - gap - boundedHeight);

      setMenuStyle({
        ...nextStyle,
        "--quantity-menu-top": `${top}px`,
      });
    }

    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    window.visualViewport?.addEventListener("resize", positionMenu);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      window.visualViewport?.removeEventListener("resize", positionMenu);
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
          ref={triggerRef}
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
          <div
            className="quantity-unit-menu"
            data-placement={menuPlacement}
            ref={menuRef}
            style={menuStyle}
          >
            <label className="quantity-unit-search">
              <SearchMd aria-hidden="true" />
              <input
                {...textEntryProps("search")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search units"
                aria-label="Search units"
                inputMode="search"
                enterKeyHint="search"
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
