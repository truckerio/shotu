import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const layout = read("./WorkorderDetailLayout.jsx");
const shell = read("./WorkorderPanelShell.jsx");
const page = read("../../features/workorder-detail/WorkorderDetailPage.jsx");
const css = read("./workorder-object-page.css");

test("office tools use the existing pointer and keyboard splitter with independent saved sizing", () => {
  assert.match(shell, /tools=\{detail && onePage\}/);
  assert.match(layout, /tools \? WORKORDER_TOOLS_LAYOUT : WORKORDER_EDITOR_LAYOUT/);
  assert.match(layout, /storageKey: "workorder.toolsPreviewPercent.v1"/);
  assert.match(layout, /onPointerDown=\{startResize\}/);
  assert.match(layout, /onKeyDown=\{resizeWithKeyboard\}/);
  assert.match(layout, /minControlWidth: 620,[\s\S]*minPreviewWidth: 360/);
  assert.match(css, /grid-template-columns: minmax\(620px, 1fr\) var\(--detail-resizer-width\) minmax\(360px, var\(--preview-pane-width\)\)/);
});

test("compact tools preserve desktop sizing and Chat lives only in the tools panel", () => {
  assert.match(layout, /if \(tools && window.innerWidth < 1280\) return/);
  assert.match(css, /\.has-tools-layout > \.detail-pane-resizer \{ display: none; \}/);
  assert.match(page, /previewOpen=\{isOfficeDetail \? officeToolsOpen/);
  assert.match(page, /id: "chat", label: chatPolicy.canRead \? "Chat" : "Notes"/);
  assert.match(page, /isOfficeDetail \? officeToolsOpen && officeToolView === "chat"/);
  assert.doesNotMatch(page, /workorder-inline-chat/);
});
