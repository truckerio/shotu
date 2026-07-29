export const KIOSK_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

export const KIOSK_ACTIVITY_EVENTS = Object.freeze([
  "pointerdown",
  "keydown",
  "touchstart",
  "input",
  "focus",
]);

export function kioskPinValue(value) {
  return String(value || "").replace(/\D/g, "");
}

export function isCompleteKioskPin(value) {
  return /^\d{4,}$/.test(value);
}

export function kioskUnlockError(status) {
  if (status === 400) return "Use at least four digits.";
  if (status === 423 || status === 429) return "Unable to unlock right now. Try again later.";
  return "Unable to unlock. Check the PIN and try again.";
}
