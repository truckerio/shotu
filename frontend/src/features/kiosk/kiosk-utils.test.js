import assert from "node:assert/strict";
import test from "node:test";
import {
  isCompleteKioskPin,
  KIOSK_ACTIVITY_EVENTS,
  KIOSK_IDLE_TIMEOUT_MS,
  kioskPinValue,
  kioskUnlockError,
} from "./kiosk-utils.js";

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
  assert.equal(kioskUnlockError(400), "Use at least four digits and avoid common patterns.");
  assert.equal(kioskUnlockError(401), "Unable to unlock. Check the PIN and try again.");
  assert.equal(kioskUnlockError(423), "Unable to unlock right now. Try again later.");
  assert.equal(kioskUnlockError(429), "Unable to unlock right now. Try again later.");
});
