import assert from "node:assert/strict";
import test from "node:test";
import {
  KIOSK_LOCALE_STORAGE_KEY,
  kioskMechanicIdentity,
  kioskMechanicsInDisplayOrder,
  kioskStoredLocale,
  saveKioskLocale,
  isCompleteKioskPin,
  KIOSK_ACTIVITY_EVENTS,
  KIOSK_IDLE_TIMEOUT_MS,
  kioskPinValue,
  kioskUnlockError,
} from "./kiosk-utils.js";

test("kiosk locale persists on the device with a safe English fallback", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };

  assert.equal(kioskStoredLocale(storage), "en");
  assert.equal(saveKioskLocale("pa", storage), "pa");
  assert.equal(values.get(KIOSK_LOCALE_STORAGE_KEY), "pa");
  assert.equal(kioskStoredLocale(storage), "pa");
  assert.equal(saveKioskLocale("unsupported", storage), "en");
  assert.equal(kioskStoredLocale({ getItem: () => { throw new Error("blocked"); } }), "en");
});

test("mechanics use natural numeric order without mutating the server roster", () => {
  const mechanics = [
    { id: "10", name: "Chino Mechanic 10", initials: "CM" },
    { id: "2", name: "Chino Mechanic 2", initials: "CM" },
    { id: "1", name: "Chino Mechanic 1", initials: "CM" },
  ];

  assert.deepEqual(
    kioskMechanicsInDisplayOrder(mechanics).map(({ id }) => id),
    ["1", "2", "10"],
  );
  assert.deepEqual(mechanics.map(({ id }) => id), ["10", "2", "1"]);
});

test("mechanic identity markers expose distinguishing text and stable tones", () => {
  const first = kioskMechanicIdentity({ id: "1", name: "Chino Mechanic 1", initials: "CM" });
  const second = kioskMechanicIdentity({ id: "2", name: "Chino Mechanic 2", initials: "CM" });
  const named = kioskMechanicIdentity({ id: "abc", name: "Jagwinder Singh", initials: "JS" });

  assert.equal(first.marker, "1");
  assert.equal(second.marker, "2");
  assert.notEqual(first.marker, second.marker);
  assert.match(first.tone, /^tone-[1-6]$/);
  assert.deepEqual(kioskMechanicIdentity({ id: "1", name: "Chino Mechanic 1", initials: "CM" }), first);
  assert.equal(named.marker, "JS");
});

test("kiosk PIN input keeps digits and accepts four or more", () => {
  assert.equal(kioskPinValue("12a3 4567 890"), "1234567890");
  assert.equal(kioskPinValue(null), "");
  assert.equal(isCompleteKioskPin("1234"), true);
  assert.equal(isCompleteKioskPin("123456"), true);
  assert.equal(isCompleteKioskPin("123"), false);
  assert.equal(isCompleteKioskPin("12345a"), false);
});

test("kiosk idle policy covers required activity and two-minute lock", () => {
  assert.equal(KIOSK_IDLE_TIMEOUT_MS, 120_000);
  for (const eventName of ["pointerdown", "keydown", "touchstart", "input", "focus"]) {
    assert.equal(KIOSK_ACTIVITY_EVENTS.includes(eventName), true);
  }
});

test("unlock errors do not leak credential or lockout details", () => {
  assert.equal(kioskUnlockError(400), "Use at least four digits.");
  assert.equal(kioskUnlockError(401), "Unable to unlock. Check the PIN and try again.");
  assert.equal(kioskUnlockError(423), "Unable to unlock right now. Try again later.");
  assert.equal(kioskUnlockError(429), "Unable to unlock right now. Try again later.");
  assert.equal(kioskUnlockError(401, "es"), "No se pudo abrir. Revisa el PIN e inténtalo de nuevo.");
});
