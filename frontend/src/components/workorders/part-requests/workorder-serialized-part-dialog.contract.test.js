import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dialog = readFileSync(new URL("./WorkorderSerializedPartDialog.jsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../UsedPartsEditor.jsx", import.meta.url), "utf8");
const scanner = readFileSync(new URL("./SerializedPartsScanner.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./workorder-serialized-part-dialog.css", import.meta.url), "utf8");

test("catalog parent selection opens one serialized-unit dialog without mutating the manual row", () => {
  assert.match(editor, /purpose="workorder_assignment"/);
  assert.match(editor, /setSerializedDialogPart\(catalogPart\)/);
  assert.doesNotMatch(editor, /onSelect=\{\(catalogPart\) => \{[\s\S]{0,500}partNo: catalogPart\.partNumber/);
  assert.match(editor, /<WorkorderSerializedPartDialog/);
  assert.match(dialog, /<ModalOverlay/);
  assert.match(dialog, /<Modal/);
  assert.match(dialog, /<Dialog/);
  assert.doesNotMatch(dialog, /<ModalOverlay[\s\S]*<ModalOverlay/);
});

test("dialog keeps on-demand intake explicit and bounded", () => {
  assert.match(dialog, /inventory-parts\/\$\{encodeURIComponent\(partId\)\}\/units/);
  assert.match(dialog, /params\.set\("limit", "25"\)/);
  assert.match(dialog, /min="1" max="25"/);
  assert.match(dialog, /const confirmation = "physically_present_at_location"/);
  assert.match(dialog, /confirmation,/);
  assert.match(dialog, /createKeyRef\.current\.identity !== identity/);
  assert.match(dialog, /idempotencyKey: createKeyRef\.current\.key/);
  assert.match(dialog, /function pendingCreateStorageKey/);
  assert.match(dialog, /actorId \|\| "session"/);
  assert.match(dialog, /window\.sessionStorage\.getItem/);
  assert.match(dialog, /storePendingCreateKey\(storageKey, createKeyRef\.current\.key\)/);
  assert.match(dialog, /clearPendingCreateKey\(storageKey\)/);
  assert.ok(dialog.indexOf("clearPendingCreateKey(storageKey)") < dialog.lastIndexOf("createKeyRef.current = { identity: \"\", key: \"\" }"), "confirmed creation clears durable storage before resetting the in-memory key");
  assert.match(dialog, /createKeyRef\.current = \{ identity: "", key: "" \}/);
  assert.match(dialog, /text\.confirm/);
  assert.match(dialog, /\{text\.printed\} \{batch\.itemCount \|\| units\.length\} \{text\.labels\}/);
  assert.match(dialog, /target="_blank"/);
});

test("dialog only closes from explicit controls and preserves post-create label state", () => {
  assert.match(dialog, /isDismissable=\{false\}/);
  assert.doesNotMatch(dialog, /onOpenChange/);
  assert.match(dialog, /event\.key === "Escape" && !busy/);
  assert.match(dialog, /setData\(result\);[\s\S]*setView\("created"\)/);
  assert.match(dialog, /href=\{batch\.printUrl\}[\s\S]*target="_blank"/);
  assert.match(dialog, /if \(!busy\) onClose\?\.\(\)/);
});

test("dialog centralizes supported locale copy and focuses the first useful control", () => {
  assert.match(dialog, /const DIALOG_TEXT =/);
  for (const locale of ["en", "es", "pa"]) assert.match(dialog, new RegExp(`${locale}: \\{ title:`));
  assert.match(dialog, /DIALOG_TEXT\[normalizeLocale\(locale\)\] \|\| DIALOG_TEXT\.en/);
  assert.match(dialog, /const canCreate = data\?\.canCreateSerializedUnits === true;/);
  assert.ok(dialog.indexOf("const canCreate") < dialog.indexOf("useEffect(() => {\n    if (!open || view !== \"units\""), "permission state must exist before the focus effect reads it");
  assert.match(dialog, /quantityRef\.current\?\.focus/);
  assert.match(dialog, /\.inventory-code-manual-action/);
  assert.match(dialog, /: canCreate \? addUnitsRef\.current : emptyStatusRef\.current/);
});

test("list, manual code, and one camera scan use the same idempotent reservation owner", () => {
  assert.match(dialog, /function reserve\(\{ unitId, code \} = \{\}\)/);
  assert.match(dialog, /inventory-units\/issue/);
  assert.match(dialog, /body: JSON\.stringify\(\{ unitId, code, idempotencyKey: requestKeyRef\.current\.key \}\)/);
  assert.match(dialog, /onScan=\{\(code\) => reserve\(\{ code \}\)\}/);
  assert.match(dialog, /onClick=\{\(\) => reserve\(\{ unitId: selectedUnitId \}\)\}/);
  assert.match(dialog, /unit\.eligible !== false/);
  assert.match(dialog, /Retain the key for a retry of this exact unit\/code/);
  assert.match(scanner, /async function recordUsage\(usage\)/);
  assert.match(scanner, /recordUsage,/);
  assert.match(editor, /serializedParts\?\.recordUsage\?\.\(usage\)/);
  assert.match(editor, /Part added; refresh the workorder if the serialized row is not visible/);
  assert.match(editor, /serializedDialogOriginRef\.current = index/);
  assert.match(editor, /document\.querySelector\(/);
});

test("dialog is touch-safe, full-screen on phone, and retains a single content scroller", () => {
  assert.match(css, /min-height: 44px/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*height: 100dvh/);
  assert.match(css, /overflow: auto/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /scroll-padding-block-end: 88px/);
  assert.match(css, /footer \.button:last-child \{ flex-basis: 100%; \}/);
});
