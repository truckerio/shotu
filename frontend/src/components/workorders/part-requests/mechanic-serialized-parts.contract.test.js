import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scanner = readFileSync(new URL("../../../features/inventory/InventoryCodeScanner.jsx", import.meta.url), "utf8");
const surface = readFileSync(new URL("./SerializedPartsScanner.jsx", import.meta.url), "utf8");
const partsModule = readFileSync(new URL("../../../features/workorder-modules/parts/WorkorderPartsModule.jsx", import.meta.url), "utf8");
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
  assert.match(surface, /scannerOpen/);
  assert.match(surface, /scannerOpen \? \(/);
  assert.match(surface, /setScannerOpen\(false\)/);
});

test("parts surface keeps scanning behind one compact accessible trigger", () => {
  assert.match(surface, /className="mechanic-scan-trigger"/);
  assert.match(surface, /aria-label=\{t\("parts\.scanParts"\)\}/);
  assert.match(surface, /data-tooltip=\{t\("parts\.scanParts"\)\}/);
  assert.match(surface, /aria-controls=\{scannerPanelId\}/);
  assert.match(surface, /aria-expanded=\{scannerOpen\}/);
  assert.match(surface, /className="mechanic-scanner-close"/);
  assert.match(surface, /scannerCloseRef\.current\?\.focus/);
  assert.match(surface, /scanTriggerRef\.current\?\.focus/);
  assert.match(surface, /setScannerOpen\(true\)/);
  assert.match(css, /\.mechanic-serialized-parts\.is-collapsed/);
  assert.match(css, /width: 44px/);
  assert.match(css, /content: attr\(data-tooltip\)/);
});

test("authorized parts surfaces expose one exact issue action and explicit final dispositions", () => {
  assert.match(surface, /t\("parts\.useOnWorkorder"\)/);
  assert.match(surface, /t\("parts\.disposition"\)/);
  assert.match(surface, /t\("parts\.installed"\)/);
  assert.match(surface, /t\("parts\.returnUnused"\)/);
  assert.match(surface, /inventory-unit-usages/);
  assert.doesNotMatch(surface, /\/api\/mechanic\//);
  assert.match(surface, /aria-live="polite"/);
  assert.match(surface, /setMessageTone\("status"\);[\s\S]*inventory-units\/issue/);
});

test("canonical scan access mounts independently from broad Parts editing", () => {
  assert.match(partsModule, /activeWorkorder\.moduleAccess\?\.partsScanning\?\.access/);
  assert.match(partsModule, /<SerializedPartsScanner/);
  assert.match(partsModule, /partsVisible \? <PartRequestsPanel/);
  assert.match(partsModule, /if \(!partsVisible && !canScanSerializedParts\) return null/);
  assert.match(partsModule, /: "Scan exact serialized parts"/);
  assert.match(partsModule, /attention=\{partsVisible && pendingPartCount > 0\}/);
});

test("scanner keeps persisted usages visible while deferring camera UI until the compact trigger opens", () => {
  assert.match(surface, /function openScanner\(\)/);
  assert.match(surface, /onClick=\{openScanner\}/);
  assert.match(surface, /loadUsages\(generation\)\.catch/);
  assert.match(surface, /shouldApplyUsageSnapshot/);
  assert.match(surface, /mergeUsageSnapshot/);
  assert.match(surface, /usageRevisionRef\.current \+= 1/);
  assert.match(surface, /scannerOpen \? \(/);
});

test("phone layout preserves touch targets and wraps final actions", () => {
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /overflow-wrap: anywhere/);
});
