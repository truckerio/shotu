import { en } from "./locales/en.js";
import { es } from "./locales/es.js";
import { pa } from "./locales/pa.js";

export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = Object.freeze(["en", "pa", "es"]);

// Keep the short preference value stable while giving Intl a locale with the
// correct regional defaults (including Punjabi numerals/date conventions).
export const INTL_LOCALES = Object.freeze({
  en: "en-US",
  pa: "pa-IN",
  es: "es-ES",
});

const dictionaries = Object.freeze({ en, pa, es });

export function localeKeys(locale = DEFAULT_LOCALE) {
  return Object.freeze(Object.keys(dictionaries[normalizeLocale(locale)] || {}));
}

export function missingLocaleKeys(locale) {
  const normalizedLocale = normalizeLocale(locale);
  if (normalizedLocale === DEFAULT_LOCALE) return [];
  const selected = new Set(localeKeys(normalizedLocale));
  return localeKeys(DEFAULT_LOCALE).filter((key) => !key.startsWith("test.") && !selected.has(key));
}

export function normalizeLocale(locale) {
  const value = String(locale || "").trim().toLowerCase();
  if (SUPPORTED_LOCALES.includes(value)) return value;
  const language = value.split(/[-_]/, 1)[0];
  return SUPPORTED_LOCALES.includes(language) ? language : DEFAULT_LOCALE;
}

export function intlLocale(locale) {
  return INTL_LOCALES[normalizeLocale(locale)];
}

export function setDocumentLocale(locale, documentRef = globalThis.document) {
  const normalized = normalizeLocale(locale);
  if (documentRef?.documentElement) {
    documentRef.documentElement.lang = intlLocale(normalized);
  }
  return normalized;
}

export function formatLocaleNumber(value, locale, options = {}) {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

export function formatLocaleParts(value, locale, options = {}) {
  return new Intl.ListFormat(intlLocale(locale), options).format(value);
}

export function formatLocalePlural(value, locale, options = {}) {
  return new Intl.PluralRules(intlLocale(locale), options).select(value);
}

// Static interface keys only. Workorder and user-entered content bypasses this owner.
export function interfaceText(locale, key) {
  const normalizedLocale = normalizeLocale(locale);
  return dictionaries[normalizedLocale]?.[key] ?? dictionaries.en[key] ?? key;
}

export function localizedUnitType(value, locale = DEFAULT_LOCALE) {
  const text = String(value || "").trim();
  const key = ({ truck: "unit.truck", trailer: "unit.trailer", other: "unit.other" })[text.toLowerCase()];
  return key ? interfaceText(locale, key) : text;
}
