import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pane = fs.readFileSync(new URL("./PreviewPane.jsx", import.meta.url), "utf8");
const controller = fs.readFileSync(new URL("../../features/workorder-detail/useWorkorderPreviewController.js", import.meta.url), "utf8");

test("nested preview menu consumes Escape without collapsing the tools pane", () => {
  assert.match(pane, /className="print-command-menu"[\s\S]*onKeyDown=\{\(event\) =>/);
  assert.match(pane, /event\.stopPropagation\(\);[\s\S]*onTogglePrintMenu/);
  assert.match(controller, /event\.defaultPrevented \|\| insideNestedOverlay/);
});
