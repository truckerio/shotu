import { interfaceText, normalizeLocale } from "./index.js";

export function LocaleSelector({ locale, onChange, error = "", compact = false }) {
  const value = normalizeLocale(locale);
  return (
    <div className={`locale-selector ${compact ? "is-compact" : ""}`.trim()}>
      <label>
        <span>{interfaceText(value, "language.label")}</span>
        <select value={value} onChange={(event) => onChange?.(event.target.value)} aria-label={interfaceText(value, "language.label")}>
          <option value="en">English</option>
          <option value="pa">ਪੰਜਾਬੀ</option>
          <option value="es">Español</option>
        </select>
      </label>
      {error ? <small role="status">{error}</small> : null}
    </div>
  );
}
