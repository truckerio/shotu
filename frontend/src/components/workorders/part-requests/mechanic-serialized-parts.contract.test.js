import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scanner = readFileSync(new URL("../../../features/inventory/InventoryCodeScanner.jsx", import.meta.url), "utf8");
const surface = readFileSync(new URL("./SerializedPartsScanner.jsx", import.meta.url), "utf8");
const partsModule = readFileSync(new URL("../../../features/workorder-modules/parts/WorkorderPartsModule.jsx", import.meta.url), "utf8");
const createScanner = readFileSync(new URL("../../../features/workorder-modules/parts/CreatePartScanner.jsx", import.meta.url), "utf8");
const usedPartsEditor = readFileSync(new URL("../UsedPartsEditor.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./mechanic-serialized-parts.css", import.meta.url), "utf8");
const mechanicLocales = ["en", "es", "pa"].map((locale) => readFileSync(new URL(`../../../i18n/locales/${locale}.js`, import.meta.url), "utf8"));

test("shared scanner is camera-only and automatically recovers after a rejected scan", () => {
  assert.match(scanner, /inFlightRef\.current/);
  assert.match(scanner, /autoStart = false/);
  assert.match(scanner, /if \(autoStart\) startCamera\(\);/);
  assert.doesNotMatch(scanner, /manualEntry|Enter code manually|<form|<input/);
  assert.match(scanner, /restartAfterError = true/);
  assert.match(scanner, /window\.setTimeout/);
  assert.match(scanner, /startCamera\(\{ preserveMessage: true \}\)/);
  assert.match(scanner, /if \(streamRef\.current\) return/);
  assert.match(scanner, /role="alert"/);
  assert.match(scanner, /getTracks\(\)\.forEach/);
  assert.match(scanner, /cameraSessionRef/);
  assert.match(scanner, /const token = session\.begin\(\);/);
  assert.match(scanner, /session\.stopIfStale\(token, stream\)/);
  assert.match(scanner, /cameraSessionRef\.current\.cancel\(\);/);
  assert.match(scanner, /scanGenerationRef/);
  assert.match(surface, /workorderGenerationRef/);
  assert.match(surface, /scannerOpen/);
  assert.match(surface, /scannerOpen \? \(/);
  assert.match(surface, /setScannerOpen\(false\)/);
});

test("parts surface opens a dedicated, accessible scanner overlay", () => {
  assert.match(surface, /className=\{`mechanic-scan-trigger/);
  assert.match(surface, /aria-label=\{t\("parts\.scanParts"\)\}/);
  assert.match(surface, /data-tooltip=\{tablePresentation \? undefined : t\("parts\.scanParts"\)\}/);
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

test("minimal scanner is camera-first with only close before a scan result", () => {
  assert.match(surface, /<ModalOverlay[\s\S]*<InventoryCodeScanner[\s\S]*autoStart/);
  assert.match(surface, /className="mechanic-scanner-close"/);
  assert.match(surface, /aria-label=\{t\("parts\.closeScanner"\)\}/);
  assert.match(surface, /onClick=\{closeScanner\}/);
  assert.match(surface, /<InventoryCodeScanner[\s\S]*onScan=\{resolve\}/);

  // Scanner chrome stays invisible; camera and Close remain.
  assert.doesNotMatch(scanner, /<h[1-6][^>]*>.*\{title\}/);
  assert.doesNotMatch(scanner, /inventory-code-scan-guide/);
  assert.doesNotMatch(scanner, /inventory-code-camera-status/);
  assert.doesNotMatch(scanner, /\{text\.stopCamera\}/);
  assert.doesNotMatch(scanner, /inventory-code-qr-note/);
  assert.doesNotMatch(scanner, /inventory-code-manual-action/);
  assert.doesNotMatch(scanner, /codeLabel|codePlaceholder|openPart|checking/);
  assert.doesNotMatch(surface, /stopCamera:/);
  assert.doesNotMatch(surface, /cameraReady:/);
  assert.doesNotMatch(surface, /qrOnly:/);
});

test("scanner stops camera before delivering a QR result", () => {
  const detected = scanner.indexOf("result?.rawValue");
  const stopBeforeSubmit = scanner.indexOf("stopCamera();", detected);
  const submitAfterDetection = scanner.indexOf("await submit(result.rawValue);", detected);
  assert.ok(detected >= 0, "camera loop must deliver detected QR values");
  assert.ok(stopBeforeSubmit > detected, "QR detection must stop the camera");
  assert.ok(submitAfterDetection > stopBeforeSubmit, "QR delivery must happen after camera stop");
});

test("camera denial or unavailable support remains a camera-only error", () => {
  assert.match(scanner, /!inventoryScannerAvailable\(window\)[\s\S]*setMessage\(text\.cameraUnavailable\)/);
  assert.match(scanner, /catch[\s\S]*setMessage\(text\.cameraAccessUnavailable\)/);
  assert.doesNotMatch(scanner, /Paste|paste|manual|Manual/);
  assert.doesNotMatch(surface, /parts\.(?:enterCode|codeLabel|codePlaceholder|checking|openPart|cameraUnavailable|cameraAccessUnavailable)/);
  assert.doesNotMatch(createScanner, /parts\.(?:enterCode|codeLabel|codePlaceholder|checking|openPart|cameraUnavailable|cameraAccessUnavailable)/);
  assert.match(surface, /locale=\{locale\}/);
  assert.match(createScanner, /locale=\{locale\}/);
});

test("authorized parts surfaces reserve exact units and route removal through custody", () => {
  assert.match(surface, /t\("parts\.reserveForWorkorder"\)/);
  assert.match(surface, /t\("parts\.reservedForWorkorder"\)/);
  assert.match(surface, /t\("parts\.disposition"\)/);
  assert.match(surface, /t\("parts\.markInstalled"\)/);
  assert.match(surface, /t\("parts\.returnUnused"\)/);
  assert.match(surface, /t\("parts\.removeFromUnit"\)/);
  assert.match(surface, /<SecondaryDetailPanel/);
  assert.match(surface, /<UnitPartsLifecycle/);
  assert.match(surface, /initialUsageId=\{custodyUsage\.id\}/);
  assert.match(surface, /onBusyChange=\{setCustodyBusy\}/);
  assert.match(surface, /inventory-unit-usages.*\/finalize/);
  assert.doesNotMatch(surface, /disposition: usage\.status === "installed_pending_approval" \? "returned" : "removed"/);
  assert.match(surface, /inventory-unit-usages/);
  assert.doesNotMatch(surface, /\/api\/mechanic\//);
  assert.match(surface, /aria-live="polite"/);
  assert.match(surface, /setMessageTone\("status"\);[\s\S]*inventory-units\/issue/);
});

test("canonical scan access mounts independently from broad Parts editing", () => {
  assert.match(partsModule, /activeWorkorder\.moduleAccess\?\.partsScanning\?\.access/);
  assert.match(partsModule, /<SerializedPartsScanner/);
  assert.match(partsModule, /function renderPartsPanel\(serializedParts = null\)/);
  assert.match(partsModule, /serializedParts=\{serializedParts\}/);
  assert.match(partsModule, /\{partsVisible \? renderPartsPanel : null\}/);
  assert.match(partsModule, /\) : renderPartsPanel\(\)\}/);
  assert.match(partsModule, /if \(!partsVisible && !canScanSerializedParts\) return null/);
  assert.match(partsModule, /: "Scan exact serialized parts"/);
  assert.match(partsModule, /attention=\{partsVisible && pendingPartCount > 0\}/);
});

test("parts-visible scanning projects usage state and actions into the canonical table", () => {
  assert.match(surface, /const tablePresentation = typeof children === "function"/);
  assert.match(surface, /children\(\{[\s\S]*scanControl,[\s\S]*usages,[\s\S]*usageSnapshotReady/);
  assert.match(surface, /finishScannerAfterFinalIssue\(result\.usage\.id\)/);
  assert.match(surface, /focusUsageId/);
  assert.match(usedPartsEditor, /activeSerializedParts/);
  assert.match(usedPartsEditor, /serializedParts\.finalize\(usage, "installed"\)/);
  assert.match(usedPartsEditor, /serializedParts\.finalize\(usage, "returned"\)/);
  assert.match(usedPartsEditor, /serializedParts\.requestRemove\(usage\)/);
  assert.doesNotMatch(usedPartsEditor, /serializedParts\.removeFromUnit\(usage\)/);
  assert.match(usedPartsEditor, /className="used-parts-serialized-history"/);
  assert.match(usedPartsEditor, /<details/);
});

test("scanner-only access retains its compact standalone lifecycle surface", () => {
  assert.match(partsModule, /\{partsVisible \? renderPartsPanel : null\}/);
  assert.match(surface, /if \(tablePresentation\)[\s\S]*return \([\s\S]*children\(\{/);
  assert.match(surface, /<section className=\{`mechanic-serialized-parts/);
  assert.match(surface, /actionable\.map/);
  assert.match(surface, /completed\.map/);
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
  assert.doesNotMatch(css, /inventory-code-manual-action|inventory-code-scanner form|inventory-code-scanner input/);
  assert.doesNotMatch(css, /inventory-code-qr-note/);
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
  assert.doesNotMatch(css, /inventory-code-manual-action|inventory-code-scanner form|inventory-code-scanner input/);
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
      "parts.reserveForWorkorder",
      "parts.reservedForWorkorder",
      "parts.markInstalled",
      "parts.removeFromUnit",
      "parts.removeReturnConfirm",
      "parts.removeInspectionConfirm",
      "parts.confirmRemove",
      "parts.removedReturnedToStock",
      "parts.removedInspectionRequired",
      "parts.previousScannedParts",
      "parts.repairAfterInstalled",
      "parts.statusAction",
    ]) {
      assert.match(dictionary, new RegExp(`"${key}":\\s*"[^"\\n]+"`));
    }
  }
});
