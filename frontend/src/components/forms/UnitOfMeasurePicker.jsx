import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, SearchMd } from "@untitledui/icons";
import { getUnitDefinition, normalizeUomCode } from "../../../../shared/units-of-measure.js";
import { unitOptionGroups } from "./quantity-unit-model.js";
import { textEntryProps } from "./text-entry-policy.js";
import { interfaceText } from "../../i18n/index.js";
import "./quantity-unit-input.css";

export function UnitOfMeasurePicker({ uomCode, onChange, label = "Unit", disabled = false, readOnly = false, id, locale = "en", ...ariaProps }) {
  const t = (key) => interfaceText(locale, key);
  const generatedId = useId();
  const inputId = id || `unit-${generatedId}`;
  const listboxId = `${inputId}-units`;
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuPlacement, setMenuPlacement] = useState("below");
  const [menuStyle, setMenuStyle] = useState(undefined);
  const code = normalizeUomCode(uomCode);
  const definition = getUnitDefinition(code);
  const groups = useMemo(() => unitOptionGroups(query, (kind, value) => t(`uom.${kind}.${value}`)), [locale, query]);

  useEffect(() => {
    if (!open) return undefined;
    function closeOnOutsidePointer(event) { if (!rootRef.current?.contains(event.target)) setOpen(false); }
    function closeOnEscape(event) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (open && window.matchMedia("(pointer: fine)").matches) searchRef.current?.focus();
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
      const openBelow = availableBelow >= Math.min(menuHeight, minimumUsefulHeight) || availableBelow >= availableAbove;
      setMenuPlacement(openBelow ? "below" : "above");
      const boundedHeight = Math.min(isMobile ? 420 : 360, Math.max(160, openBelow ? availableBelow : availableAbove));
      const nextStyle = { "--quantity-menu-max-height": `${boundedHeight}px` };
      if (!isMobile) { setMenuStyle(nextStyle); return; }
      const top = openBelow ? triggerRect.bottom + gap : Math.max(gutter, triggerRect.top - gap - boundedHeight);
      setMenuStyle({ ...nextStyle, "--quantity-menu-top": `${top}px` });
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

  function selectUnit(nextCode) {
    onChange?.(nextCode);
    setOpen(false);
    setQuery("");
  }

  return <div className="quantity-unit-picker" ref={rootRef}>
    <button {...ariaProps} id={inputId} ref={triggerRef} type="button" className="quantity-unit-trigger" aria-expanded={open} aria-controls={listboxId} aria-label={`${label}: ${definition.symbol}`} disabled={disabled || readOnly} onClick={() => setOpen((current) => !current)}>
      <strong>{definition.symbol}</strong>
      {!readOnly ? <ChevronDown aria-hidden="true" /> : null}
    </button>
    {open ? <div className="quantity-unit-menu" data-placement={menuPlacement} ref={menuRef} style={menuStyle}>
      <label className="quantity-unit-search"><SearchMd aria-hidden="true" /><input ref={searchRef} {...textEntryProps("search")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("uom.searchUnits")} aria-label={t("uom.searchUnits")} inputMode="search" enterKeyHint="search" /></label>
      <div id={listboxId} className="quantity-unit-options" aria-label={t("uom.unitsOfMeasure")}>
        {groups.length ? groups.map((group) => <section key={group.category}><strong>{group.label}</strong><div>{group.units.map((unit) => <button type="button" aria-pressed={unit.code === code} className={unit.code === code ? "is-selected" : ""} onClick={() => selectUnit(unit.code)} key={unit.code}><span>{t(`uom.unit.${unit.code}`)}</span><small>{unit.symbol}</small></button>)}</div></section>) : <p>{t("uom.noUnits")}</p>}
      </div>
    </div> : null}
  </div>;
}
