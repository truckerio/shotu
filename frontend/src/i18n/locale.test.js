import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LOCALE,
  formatLocaleNumber,
  formatLocalePlural,
  interfaceText,
  intlLocale,
  localeKeys,
  localizedUnitType,
  missingLocaleKeys,
  normalizeLocale,
  setDocumentLocale,
  SUPPORTED_LOCALES,
} from "./index.js";

test("supported mechanic locales normalize with an English fallback", () => {
  assert.equal(DEFAULT_LOCALE, "en");
  assert.deepEqual(SUPPORTED_LOCALES, ["en", "pa", "es"]);
  assert.equal(normalizeLocale("pa"), "pa");
  assert.equal(normalizeLocale("es"), "es");
  assert.equal(normalizeLocale("fr"), "en");
  assert.equal(normalizeLocale(null), "en");
  assert.equal(normalizeLocale("es-MX"), "es");
  assert.equal(intlLocale("pa"), "pa-IN");
});

test("locale contract exposes dictionary parity and Intl helpers", () => {
  assert.ok(localeKeys("en").includes("kiosk.chooseName"));
  assert.deepEqual(missingLocaleKeys("es"), []);
  assert.deepEqual(missingLocaleKeys("pa"), []);
  assert.equal(formatLocaleNumber(1234567.5, "en"), "1,234,567.5");
  assert.equal(formatLocalePlural(1, "en"), "one");
  assert.equal(formatLocalePlural(2, "es"), "other");
});

test("document language uses the explicit Intl locale without touching content", () => {
  const documentRef = { documentElement: {} };
  assert.equal(setDocumentLocale("pa", documentRef), "pa");
  assert.equal(documentRef.documentElement.lang, "pa-IN");
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

test("known unit enums localize while provider values stay unchanged", () => {
  assert.equal(localizedUnitType("Truck", "es"), "Camión");
  assert.equal(localizedUnitType("Trailer", "pa"), "ਟ੍ਰੇਲਰ");
  assert.equal(localizedUnitType("Special rig", "es"), "Special rig");
});

test("unknown keys are returned unchanged instead of transforming user content", () => {
  const originalConcern = "Inspect brake chamber on unit G2211";
  assert.equal(interfaceText("pa", originalConcern), originalConcern);
  assert.equal(interfaceText("es", originalConcern), originalConcern);
});
