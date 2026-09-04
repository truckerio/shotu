import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../ui/Button.jsx";
import { normalizeLocale } from "../../../i18n/index.js";
import { eligibleSelectedUnitIds } from "./workorder-serialized-part-selection.js";
import { SerializedUnitChildPicker } from "./SerializedUnitChildPicker.jsx";
import "./serialized-unit-nested-dropdown.css";

const TEXT = {
  en: { title: "Serial numbers", search: "Search serial", placeholder: "Serial number", done: "Done", loading: "Loading serial numbers…", empty: "No serialized units are available at this location." },
  es: { title: "Números de serie", search: "Buscar serie", placeholder: "Número de serie", done: "Listo", loading: "Cargando números de serie…", empty: "No hay unidades serializadas disponibles en esta ubicación." },
  pa: { title: "ਸੀਰੀਅਲ ਨੰਬਰ", search: "ਸੀਰੀਅਲ ਲੱਭੋ", placeholder: "ਸੀਰੀਅਲ ਨੰਬਰ", done: "ਮੁਕੰਮਲ", loading: "ਸੀਰੀਅਲ ਨੰਬਰ ਲੋਡ ਹੋ ਰਹੇ ਹਨ…", empty: "ਇਸ ਟਿਕਾਣੇ ਤੇ ਕੋਈ ਸੀਰੀਅਲ ਯੂਨਿਟ ਉਪਲਬਧ ਨਹੀਂ ਹੈ।" },
};

function serialText(unit) {
  return String(unit?.serialNumber || unit?.serial || "").trim();
}

export function SerializedUnitNestedDropdown({
  busy = false,
  autoFocusSearch = true,
  confirmLabel = "",
  description = "",
  emptyAction = null,
  emptyMessage = "",
  error = "",
  footerAction = null,
  loading = false,
  locale = "en",
  locationName = "",
  maxSelected = 100,
  onClose,
  onConfirm,
  onQueryChange,
  onSearch,
  onSelectionChange,
  partNumber = "",
  query,
  selectedUnitIds = [],
  showConfirmCount = true,
  topContent = null,
  units = [],
}) {
  const text = TEXT[normalizeLocale(locale)] || TEXT.en;
  const titleId = useId();
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [localQuery, setLocalQuery] = useState("");
  const [viewportShift, setViewportShift] = useState({ x: 0, y: 0 });
  const searchQuery = query === undefined ? localQuery : query;
  const selected = selectedUnitIds instanceof Set
    ? selectedUnitIds
    : new Set(Array.isArray(selectedUnitIds) ? selectedUnitIds : []);
  const selectedCount = eligibleSelectedUnitIds(units, selected).length;
  const visibleUnits = useMemo(() => {
    if (onSearch || !searchQuery.trim()) return units;
    const normalized = searchQuery.trim().toLocaleLowerCase();
    return units.filter((unit) => serialText(unit).toLocaleLowerCase().includes(normalized));
  }, [onSearch, searchQuery, units]);

  useEffect(() => {
    if (!autoFocusSearch) return undefined;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocusSearch]);

  useEffect(() => {
    function closeFromOutside(event) {
      if (!busy && !rootRef.current?.contains(event.target)) onCloseRef.current?.();
    }
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, [busy]);

  useLayoutEffect(() => {
    function measure() {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const bottomInset = window.matchMedia("(max-width: 640px)").matches ? 120 : 16;
      const next = {
        x: Math.max(0, rect.right + viewportShift.x - window.innerWidth + 16),
        y: Math.max(0, rect.bottom + viewportShift.y - window.innerHeight + bottomInset),
      };
      setViewportShift((current) => current.x === next.x && current.y === next.y ? current : next);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [error, loading, viewportShift.x, viewportShift.y, visibleUnits.length]);

  function updateQuery(value) {
    if (query === undefined) setLocalQuery(value);
    onQueryChange?.(value);
  }

  function submitSearch(event) {
    event.preventDefault();
    onSearch?.(searchQuery);
  }

  return (
    <section
      ref={rootRef}
      className="serialized-unit-nested-dropdown"
      style={viewportShift.x || viewportShift.y ? { transform: `translate(${-viewportShift.x}px, ${-viewportShift.y}px)` } : undefined}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          event.stopPropagation();
          onClose?.();
        }
      }}
    >
      <header>
        <div>
          <span id={titleId}>{text.title}</span>
          <strong>{partNumber}</strong>
          {description ? <small>{description}</small> : null}
          {locationName ? <small>{locationName}</small> : null}
        </div>
      </header>
      <div className="serialized-unit-nested-content">
        {topContent}
        <form className="serialized-unit-nested-search" onSubmit={submitSearch}>
          <label htmlFor={`${titleId}-search`}>{text.search}</label>
          <input
            ref={searchRef}
            id={`${titleId}-search`}
            type="search"
            value={searchQuery}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder={text.placeholder}
            disabled={busy}
          />
          {onSearch ? <Button type="submit" disabled={busy || loading}>{text.search}</Button> : null}
        </form>
        {error ? <p className="serialized-unit-nested-message" role="alert">{error}</p> : null}
        {loading ? <p className="serialized-unit-nested-state" role="status">{text.loading}</p> : null}
        {!loading && !error && !visibleUnits.length ? (
          <div className="serialized-unit-nested-empty" role="status">
            <span>{emptyMessage || text.empty}</span>
            {emptyAction}
          </div>
        ) : null}
        {visibleUnits.length ? (
          <SerializedUnitChildPicker
            disabled={busy}
            locale={locale}
            maxSelected={maxSelected}
            onSelectionChange={onSelectionChange}
            selectedUnitIds={selected}
            units={visibleUnits}
          />
        ) : null}
      </div>
      <footer>
        <div>
          {footerAction}
          <Button type="button" variant="primary" onClick={onConfirm || onClose} disabled={busy || (onConfirm && selectedCount === 0)}>
            {onConfirm && showConfirmCount ? `${confirmLabel || text.done} (${selectedCount})` : confirmLabel || text.done}
          </Button>
        </div>
      </footer>
    </section>
  );
}
