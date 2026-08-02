import { en } from "./locales/en.js";
import { es } from "./locales/es.js";
import { pa } from "./locales/pa.js";

export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = Object.freeze(["en", "pa", "es"]);

const dictionaries = Object.freeze({ en, pa, es });

export function normalizeLocale(locale) {
  return SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}

// Static interface keys only. Workorder and user-entered content bypasses this owner.
export function interfaceText(locale, key) {
  const normalizedLocale = normalizeLocale(locale);
  return dictionaries[normalizedLocale]?.[key] ?? dictionaries.en[key] ?? key;
}
