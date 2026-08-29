import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scanner = readFileSync(new URL("../../../features/inventory/InventoryCodeScanner.jsx", import.meta.url), "utf8");
const surface = readFileSync(new URL("./SerializedPartsScanner.jsx", import.meta.url), "utf8");
const partsModule = readFileSync(new URL("../../../features/workorder-modules/parts/WorkorderPartsModule.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./mechanic-serialized-parts.css", import.meta.url), "utf8");
const mechanicLocales = ["en", "es", "pa"].map((locale) => readFileSync(new URL(`../../../i18n/locales/${locale}.js`, import.meta.url), "utf8"));

test("shared scanner has camera-first auto-start and manual fallback", () => {
  assert.match(scanner, /inFlightRef\.current/);
  assert.match(scanner, /autoStart = false/);
  assert.match(scanner, /if \(autoStart\) startCamera\(\);/);
  assert.match(scanner, /manualEntry/);
  assert.match(scanner, /stopCamera\(\); setManualEntry\(true\);/);
  assert.match(scanner, /setMessage\(text\.cameraUnavailable\);\s*setManualEntry\(true\);/);
  assert.match(scanner, /setMessage\(text\.cameraAccessUnavailable\);\s*setManualEntry\(true\);/);
  assert.match(scanner, /Enter code manually/);
  assert.match(scanner, /role="alert"/);
  assert.match(scanner, /getTracks\(\)\.forEach/);
  assert.match(scanner, /cameraSessionRef/);
  assert.match(scanner, /const token = session\.begin\(\);/);
  assert.match(scanner, /session\.stopIfStale\(token, stream\)/);
  assert.match(scanner, /cameraSessionRef\.current\.cancel\(\);/);
  assert.match(scanner, /scanGenerationRef/);
  assert.match(scanner, /useId\(\)/);
  assert.match(surface, /workorderGenerationRef/);
  assert.match(surface, /scannerOpen/);
  assert.match(surface, /scannerOpen \? \(/);
  assert.match(surface, /setScannerOpen\(false\)/);
});

test("parts surface opens a dedicated, accessible scanner overlay", () => {
  assert.match(surface, /className="mechanic-scan-trigger"/);
  assert.match(surface, /aria-label=\{t\("parts\.scanParts"\)\}/);
  assert.match(surface, /data-tooltip=\{t\("parts\.scanParts"\)\}/);
  assert.match(surface, /aria-controls=\{scannerPanelId\}/);
  assert.match(surface, /aria-expanded=\{scannerOpen\}/);
  assert.match(surface, /<ModalOverlay/);
  assert.match(surface, /className="mechanic-scanner-overlay"/);
  assert.match(surface, /<Dialog className="mechanic-scanner-panel"/);
  assert.match(surface, /autoStart/);
  assert.match(surface, /className="mechanic-scanner-close"/);
  assert.match(surface, /scannerCloseRef\.current\?\.focus/);
  assert.match(surface, /scanTriggerRef\.current\?\.focus/);
  assert.match(surface, /setScannerOpen\(true\)/);
  assert.match(css, /\.mechanic-serialized-parts\.is-collapsed/);
  assert.match(css, /width: 44px/);
  assert.match(css, /content: attr\(data-tooltip\)/);
});

test("minimal scanner is camera-first with only close and manual recovery controls", () => {
  assert.match(surface, /<ModalOverlay[\s\S]*<InventoryCodeScanner[\s\S]*autoStart/);
  assert.match(surface, /className="mechanic-scanner-close"/);
  assert.match(surface, /aria-label=\{t\("parts\.closeScanner"\)\}/);
  assert.match(surface, /onClick=\{closeScanner\}/);
  assert.match(surface, /<InventoryCodeScanner[\s\S]*onScan=\{resolve\}/);

  // Scanner chrome stays invisible; camera and recovery controls remain.
  assert.doesNotMatch(scanner, /<h[1-6][^>]*>.*\{title\}/);
  assert.doesNotMatch(scanner, /inventory-code-scan-guide/);
  assert.doesNotMatch(scanner, /inventory-code-camera-status/);
  assert.doesNotMatch(scanner, /\{text\.stopCamera\}/);
  assert.doesNotMatch(scanner, /inventory-code-qr-note/);
  assert.doesNotMatch(surface, /stopCamera:/);
  assert.doesNotMatch(surface, /cameraReady:/);
  assert.doesNotMatch(surface, /qrOnly:/);
});

test("scanner stops camera before manual entry and before delivering a QR result", () => {
  const manualAction = scanner.indexOf("stopCamera(); setManualEntry(true);");
  assert.ok(manualAction >= 0, "manual entry must stop the camera first");

  const detected = scanner.indexOf("result?.rawValue");
  const stopBeforeSubmit = scanner.indexOf("stopCamera();", detected);
  const submitAfterDetection = scanner.indexOf("await submit(result.rawValue);", detected);
  assert.ok(detected >= 0, "camera loop must deliver detected QR values");
  assert.ok(stopBeforeSubmit > detected, "QR detection must stop the camera");
  assert.ok(submitAfterDetection > stopBeforeSubmit, "QR delivery must happen after camera stop");
});

test("camera denial or unavailable support enters manual recovery", () => {
  assert.match(scanner, /!inventoryScannerAvailable\(window\)[\s\S]*setManualEntry\(true\)/);
  assert.match(scanner, /catch[\s\S]*setMessage\(text\.cameraAccessUnavailable\)[\s\S]*setManualEntry\(true\)/);
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

test("scanner keeps persisted usages visible while opening camera from the compact trigger", () => {
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
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.mechanic-scanner-panel \.inventory-code-message\s*\{\s*color: #fecdca;/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("minimal scanner CSS is edge-to-edge, safe-area aware, touch-safe, and guide-free", () => {
  assert.match(css, /inset:\s*0/);
  assert.match(css, /width:\s*100%/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /env\(safe-area-inset-(top|right|bottom|left)\)/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /\.inventory-code-scanner form \.button\s*\{\s*min-height:\s*44px;/);
  assert.match(css, /overflow:\s*hidden/);
  assert.doesNotMatch(css, /inventory-code-scan-guide/);
});

test("resolved serialized parts remain in the scanner shell and use a two-snap result drawer", () => {
  assert.match(surface, /import\s+\{\s*DraggableBottomSheet\s*\}/);
  assert.match(surface, /<DraggableBottomSheet[\s\S]*snap=\{drawerSnap\}/);
  assert.match(surface, /onSnapChange=\{handleDrawerSnapChange\}/);
  assert.match(surface, /"expanded"/);
  assert.match(surface, /"peek"/);
  assert.match(surface, /className="mechanic-scanner-result-drawer"/);
  assert.match(surface, /className="mechanic-scanner-result-summary"/);
  assert.match(surface, /className="mechanic-scanner-result-details"/);
  assert.match(surface, /className="mechanic-scanner-result-actions"/);
  assert.match(surface, /className="mechanic-scanner-pending-count"/);

  const resolveStart = surface.indexOf("async function resolve(code)");
  const issueStart = surface.indexOf("async function issue()");
  assert.ok(resolveStart >= 0 && issueStart > resolveStart, "resolve and issue owners must remain explicit");
  assert.doesNotMatch(surface.slice(resolveStart, issueStart), /setScannerOpen\(false\)/);
  assert.match(surface, /setDrawerSnap\("expanded"\)/);
  assert.match(surface, /drawerSnap !== "peek"[\s\S]*restartAfterPeekRef\.current[\s\S]*setResetKey/);
});

test("pending scanner results are deduplicated exact identities with per-result issue keys", () => {
  assert.match(surface, /pendingCandidates/);
  assert.match(surface, /selectedCandidateId/);
  assert.match(surface, /enqueuePendingCandidate\(pendingCandidates, nextCandidate\)/);
  assert.match(surface, /removePendingCandidate\(pendingCandidates, candidate\.unit\.id\)/);
  assert.match(surface, /issueKey: requestKey\("serialized-issue"\)/);
  assert.match(surface, /idempotencyKey: candidate\.issueKey/);

  const model = readFileSync(new URL("../../../features/inventory/inventory-code-scanner-model.js", import.meta.url), "utf8");
  assert.match(model, /function enqueuePendingCandidate/);
  assert.match(model, /candidate\?\.unit\?\.id/);
  assert.match(model, /find\(\(item\) => item\?\.unit\?\.id === unitId\)/);
});

test("scanner result content follows product drawer geometry without a scanner-owned backdrop", () => {
  assert.match(css, /\.mechanic-scanner-result-drawer\s*\{[\s\S]*padding:\s*0/);
  assert.match(css, /gap:\s*8px/);
  assert.match(css, /font-size:\s*14px/);
  assert.match(css, /font-size:\s*13px/);
  assert.match(css, /\.mechanic-scanner-result-actions[\s\S]*min-height:\s*44px/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.mechanic-scanner-panel:has\(\.mechanic-scanner-result-drawer\) \.inventory-code-scanner form\s*\{[\s\S]*bottom:\s*calc\(120px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.inventory-code-scanner form\s*\{[\s\S]*max-height:\s*calc\(100dvh/);
  assert.match(css, /\.inventory-code-scanner form\s*\{[\s\S]*overflow:\s*auto/);
  assert.match(css, /\.mechanic-scanner-result-details\s*\{[\s\S]*margin:\s*0/);
  assert.match(css, /\.mechanic-scanner-result-details\s*>\s*div\s*\{/);
  assert.doesNotMatch(css, /\.mechanic-scanner-result-details\s+dl/);
  assert.doesNotMatch(css, /\.mechanic-scanner-result-details\s*\{[^}]*\b(?:overflow|overscroll)-?/);
  assert.match(css, /\.mechanic-scanner-sr-status\s*\{[^}]*clip:\s*rect\(0 0 0 0\)/);
  assert.match(css, /\.mechanic-scanner-sr-status\s*\{[^}]*clip-path:\s*inset\(50%\)/);
  assert.match(css, /\.mechanic-scanner-sr-status\s*\{[^}]*white-space:\s*nowrap/);
  assert.doesNotMatch(css, /backdrop-filter/);
  assert.doesNotMatch(css, /\.mechanic-scanner-result-drawer::(before|after)/);
});

test("drawer controls and result state have complete mechanic locale coverage", () => {
  for (const dictionary of mechanicLocales) {
    for (const key of [
      "parts.scannedPart",
      "parts.pendingScans",
      "parts.minimizeResult",
      "parts.scanAnother",
      "parts.expandDetails",
      "parts.readyToUse",
      "parts.unavailable",
    ]) {
      assert.match(dictionary, new RegExp(`"${key}":\\s*"[^"\\n]+"`));
    }
  }
});
