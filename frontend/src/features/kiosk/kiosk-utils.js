import { interfaceText, normalizeLocale } from "../../i18n/index.js";

export const KIOSK_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
export const KIOSK_LOCALE_STORAGE_KEY = "workorders:kiosk-locale";

export const KIOSK_ACTIVITY_EVENTS = Object.freeze([
  "pointerdown",
  "keydown",
  "touchstart",
  "input",
  "focus",
]);

const kioskNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function kioskMechanicsInDisplayOrder(mechanics = []) {
  return [...mechanics].sort((left, right) => (
    kioskNameCollator.compare(String(left?.name || ""), String(right?.name || ""))
    || kioskNameCollator.compare(String(left?.id || ""), String(right?.id || ""))
  ));
}

export function kioskMechanicIdentity(mechanic = {}) {
  const name = String(mechanic.name || "").trim();
  const numberedName = name.match(/(\d+)\s*$/u);
  const fallbackMarker = String(mechanic.initials || "?").trim().toUpperCase() || "?";
  const identitySeed = `${mechanic.id || ""}:${name}`;
  let hash = 0;

  for (const character of identitySeed) {
    hash = ((hash * 31) + character.codePointAt(0)) >>> 0;
  }

  return {
    marker: numberedName?.[1] || fallbackMarker,
    tone: `tone-${(hash % 6) + 1}`,
  };
}

export function kioskStoredLocale(storage = globalThis.localStorage) {
  try {
    return normalizeLocale(storage?.getItem(KIOSK_LOCALE_STORAGE_KEY));
  } catch {
    return "en";
  }
}

export function saveKioskLocale(locale, storage = globalThis.localStorage) {
  const normalizedLocale = normalizeLocale(locale);
  try {
    storage?.setItem(KIOSK_LOCALE_STORAGE_KEY, normalizedLocale);
  } catch {
    // A blocked storage API must not prevent kiosk access.
  }
  return normalizedLocale;
}

export function kioskPinValue(value) {
  return String(value || "").replace(/\D/g, "");
}

export function isCompleteKioskPin(value) {
  return /^\d{4,}$/.test(value);
}

export function kioskUnlockError(status, locale = "en") {
  if (status === 400) return interfaceText(locale, "kiosk.error.minimumPin");
  if (status === 423 || status === 429) return interfaceText(locale, "kiosk.error.tryLater");
  return interfaceText(locale, "kiosk.error.invalidPin");
}
