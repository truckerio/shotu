import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LOCALE,
  interfaceText,
  normalizeLocale,
  SUPPORTED_LOCALES,
} from "./index.js";

test("supported mechanic locales normalize with an English fallback", () => {
  assert.equal(DEFAULT_LOCALE, "en");
  assert.deepEqual(SUPPORTED_LOCALES, ["en", "pa", "es"]);
  assert.equal(normalizeLocale("pa"), "pa");
  assert.equal(normalizeLocale("es"), "es");
  assert.equal(normalizeLocale("fr"), "en");
  assert.equal(normalizeLocale(null), "en");
});

test("interface text uses the selected dictionary and falls back per key", () => {
  assert.equal(interfaceText("en", "kiosk.chooseName"), "Choose your name");
  assert.equal(interfaceText("pa", "kiosk.chooseName"), "ਆਪਣਾ ਨਾਮ ਚੁਣੋ");
  assert.equal(interfaceText("es", "kiosk.chooseName"), "Elige tu nombre");
  assert.equal(interfaceText("es", "parts.usedPartAction"), "Usé una pieza");
  assert.equal(interfaceText("pa", "parts.needPartAction"), "ਮੈਨੂੰ ਪਾਰਟ ਚਾਹੀਦਾ ਹੈ");
  assert.equal(interfaceText("pa", "test.englishOnly"), "English fallback");
  assert.equal(interfaceText("invalid", "kiosk.chooseName"), "Choose your name");
});

test("unknown keys are returned unchanged instead of transforming user content", () => {
  const originalConcern = "Inspect brake chamber on unit G2211";
  assert.equal(interfaceText("pa", originalConcern), originalConcern);
  assert.equal(interfaceText("es", originalConcern), originalConcern);
});
