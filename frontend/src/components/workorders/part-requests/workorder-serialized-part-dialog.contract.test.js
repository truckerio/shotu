import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dialog = readFileSync(new URL("./WorkorderSerializedPartDialog.jsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../UsedPartsEditor.jsx", import.meta.url), "utf8");
const scanner = readFileSync(new URL("./SerializedPartsScanner.jsx", import.meta.url), "utf8");
const childPicker = readFileSync(new URL("./SerializedUnitChildPicker.jsx", import.meta.url), "utf8");
const childPickerCss = readFileSync(new URL("./serialized-unit-child-picker.css", import.meta.url), "utf8");
const nestedDropdown = readFileSync(new URL("./SerializedUnitNestedDropdown.jsx", import.meta.url), "utf8");
const nestedCss = readFileSync(new URL("./serialized-unit-nested-dropdown.css", import.meta.url), "utf8");
const css = readFileSync(new URL("./workorder-serialized-part-dialog.css", import.meta.url), "utf8");
const editorCss = readFileSync(new URL("../used-parts-editor.css", import.meta.url), "utf8");

test("inventory finder routes countable catalog selections to one nested serialized-unit dropdown without creating a manual row", () => {
  assert.match(editor, /purpose="workorder_assignment"/);
  assert.match(editor, /value=\{catalogQuery\}/);
  assert.match(editor, /className="create-part-identity-field used-parts-manual-picker"/);
  assert.match(editor, /setCatalogQuery\(catalogPart\.partNumber\)/);
  assert.match(editor, /setSerializedDialogPart\(catalogPart\)/);
  assert.doesNotMatch(editor, /used-part-quantity-/);
  assert.doesNotMatch(editor, /addUsedPart|usedPartsAutosave|recoveredUnsavedEntries/);
  assert.match(editor, /<WorkorderSerializedPartDialog/);
  assert.match(dialog, /<SerializedUnitNestedDropdown/);
  assert.doesNotMatch(dialog, /<ModalOverlay|<Modal|<Dialog/);
  assert.match(editorCss, /used-parts-manual-picker > \.serialized-unit-nested-dropdown[\s\S]*left:\s*calc\(100% \+ 8px\)/);
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

test("nested dropdown dismisses predictably and preserves post-create label state", () => {
  assert.match(nestedDropdown, /document\.addEventListener\("pointerdown", closeFromOutside\)/);
  assert.match(nestedDropdown, /event\.key === "Escape"/);
  assert.doesNotMatch(nestedDropdown, /serialized-unit-nested-close/);
  assert.match(dialog, /event\.key === "Escape" && !busy/);
  assert.match(dialog, /setData\(result\);[\s\S]*setView\("created"\)/);
  assert.match(dialog, /href=\{batch\.printUrl\}[\s\S]*target="_blank"/);
  assert.match(dialog, /if \(!busy\) onClose\?\.\(\)/);
});

test("dialog centralizes supported locale copy and the shared dropdown focuses serial search", () => {
  assert.match(dialog, /const DIALOG_TEXT =/);
  for (const locale of ["en", "es", "pa"]) assert.match(dialog, new RegExp(`${locale}: \\{ title:`));
  assert.match(dialog, /DIALOG_TEXT\[normalizeLocale\(locale\)\] \|\| DIALOG_TEXT\.en/);
  assert.match(dialog, /const canCreate = data\?\.canCreateSerializedUnits === true;/);
  assert.match(dialog, /quantityRef\.current\?\.focus/);
  assert.match(nestedDropdown, /searchRef\.current\?\.focus/);
  assert.match(nestedDropdown, /if \(!autoFocusSearch\) return undefined/);
});

test("camera scanning stays in the dedicated scanner while manual selection stays in the part dialog", () => {
  assert.doesNotMatch(dialog, /InventoryCodeScanner/);
  assert.match(scanner, /<InventoryCodeScanner/);
  assert.match(scanner, /autoStart/);
  assert.match(scanner, /onScan=\{resolve\}/);
  assert.match(scanner, /inventory-units\/issue/);
  assert.match(scanner, /async function recordUsage\(usage\)/);
  assert.match(scanner, /recordUsage,/);
  assert.match(editor, /serializedParts\?\.recordUsage\?\.\(usage\)/);
  assert.match(editor, /Part added; refresh the workorder if the serialized row is not visible/);
  assert.match(editor, /value=\{catalogQuery\}/);
  assert.match(editor, /function closeSerializedDialog\(\)/);
});

test("catalog units are independently selectable and submit every selected eligible serial in sequence", () => {
  assert.match(dialog, /const \[selectedUnitIds, setSelectedUnitIds\] = useState\(\(\) => new Set\(\)\)/);
  assert.match(dialog, /<SerializedUnitNestedDropdown/);
  assert.match(nestedDropdown, /<SerializedUnitChildPicker/);
  assert.match(dialog, /onSelectionChange=\{setSelectedUnitIds\}/);
  assert.doesNotMatch(childPicker, /type="radio"/);
  assert.match(childPicker, /type="checkbox"/);
  assert.match(childPicker, /eligibleUnits\.slice\(0, maxSelected\)/);
  assert.match(dialog, /async function reserveSelectedUnits\(\)/);
  assert.match(dialog, /issueSelectedSerializedUnits\(\{/);
  assert.match(dialog, /keyByUnitId: unitRequestKeysRef\.current/);
  assert.match(dialog, /body: JSON\.stringify\(\{ unitId, idempotencyKey \}\)/);
  assert.match(dialog, /onIssued: \(result\) => onReserved\?\.\(result\.usage, result\)/);
  assert.match(dialog, /if \(!failures\.length\) \{[\s\S]*onClose\?\.\(\)/);
});

test("partial multi-unit issue keeps only failed units selected and never reissues successes", () => {
  assert.match(dialog, /const succeeded = new Set\(successes\)/);
  assert.match(dialog, /unitsFrom\(current\)\.filter\(\(unit\) => !succeeded\.has\(unit\.id\)\)/);
  assert.match(dialog, /setSelectedUnitIds\(new Set\(failures\.map\(\(\{ id \}\) => id\)\)\)/);
  assert.match(dialog, /review and retry the selected units/);
  assert.match(dialog, /unitRequestKeysRef\.current = new Map\(\)/);
});

test("the parent records each serialized usage without taking ownership of dialog close timing", () => {
  const onReserved = editor.match(/onReserved=\{async \(usage\) => \{([\s\S]*?)\n    \}\}/);
  assert.ok(onReserved, "serialized dialog must receive an async usage callback");
  assert.match(onReserved[1], /await serializedParts\?\.recordUsage\?\.\(usage\)/);
  assert.match(onReserved[1], /Part added; refresh the workorder if the serialized row is not visible/);
  assert.doesNotMatch(onReserved[1], /setSerializedDialogPart\(null\)/);
  assert.match(dialog, /onIssued: \(result\) => onReserved\?\.\(result\.usage, result\)/);
  assert.match(dialog, /if \(!failures\.length\) \{[\s\S]*onClose\?\.\(\)/);
});

test("nested dropdown is touch-safe, responsive, and retains one content scroller", () => {
  assert.match(nestedCss, /min-height:\s*44px/);
  assert.match(nestedCss, /@media \(max-width: 640px\)/);
  assert.match(nestedCss, /\.serialized-unit-nested-content\s*\{[\s\S]*overflow:\s*auto/s);
  assert.match(nestedCss, /prefers-reduced-motion: reduce/);
  assert.match(nestedCss, /max-height:\s*min\(24rem, calc\(100dvh - 9rem\)\)/);
  assert.match(nestedDropdown, /max-width: 640px[\s\S]*\? 120 : 16/);
  assert.match(nestedCss, /\.serialized-unit-nested-dropdown \.serialized-unit-nested-search input,[\s\S]*min-height:\s*44px/);
  assert.match(nestedCss, /> footer \.button\s*\{[\s\S]*width:\s*auto/s);
  assert.match(childPickerCss, /\.serialized-unit-child-actions \.button\s*\{[^}]*width:\s*fit-content/s);
});

test("manual intake uses one shared nested hierarchy across chooser and label-ready states", () => {
  assert.match(nestedDropdown, /className="serialized-unit-nested-dropdown"/);
  assert.match(dialog, /showDescription/);
  assert.match(dialog, /className="workorder-serialized-ready"/);
  assert.match(nestedDropdown, /className="serialized-unit-nested-empty"/);
  assert.match(nestedDropdown, /<SerializedUnitChildPicker/);
  assert.doesNotMatch(dialog, /workorder-serialized-scan/);
});

test("zero-stock state presents one next action without an unusable selection footer", () => {
  assert.match(dialog, /emptyAction=\{canCreate \? <Button[\s\S]*text\.addUnits/);
  assert.match(nestedDropdown, /!loading && !error && !visibleUnits\.length/);
  assert.match(nestedDropdown, /disabled=\{busy \|\| \(onConfirm && selectedCount === 0\)\}/);
});
