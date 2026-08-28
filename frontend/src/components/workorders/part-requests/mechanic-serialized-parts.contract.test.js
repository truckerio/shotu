import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scanner = readFileSync(new URL("../../../features/inventory/InventoryCodeScanner.jsx", import.meta.url), "utf8");
const surface = readFileSync(new URL("./MechanicSerializedParts.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./mechanic-serialized-parts.css", import.meta.url), "utf8");

test("shared scanner has manual fallback, in-flight protection, and accessible status", () => {
  assert.match(scanner, /inFlightRef\.current/);
  assert.match(scanner, /Label link or code/);
  assert.match(scanner, /role="alert"/);
  assert.match(scanner, /cameraLabel: "Serialized-part QR scanner camera"/);
  assert.match(scanner, /aria-label=\{text\.cameraLabel\}/);
  assert.match(surface, /cameraLabel: t\("parts\.scannerCamera"\)/);
  assert.match(scanner, /getTracks\(\)\.forEach/);
  assert.match(scanner, /cameraGenerationRef/);
  assert.match(scanner, /scanGenerationRef/);
  assert.match(scanner, /useId\(\)/);
  assert.match(surface, /workorderGenerationRef/);
});

test("mechanic surface exposes one issue action and explicit final dispositions", () => {
  assert.match(surface, /t\("parts\.useOnWorkorder"\)/);
  assert.match(surface, /t\("parts\.disposition"\)/);
  assert.match(surface, /t\("parts\.installed"\)/);
  assert.match(surface, /t\("parts\.returnUnused"\)/);
  assert.match(surface, /inventory-unit-usages/);
  assert.match(surface, /aria-live="polite"/);
  assert.match(surface, /setMessageTone\("status"\);[\s\S]*inventory-units\/issue/);
});

test("phone layout preserves touch targets and wraps final actions", () => {
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /overflow-wrap: anywhere/);
});
