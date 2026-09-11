import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const layout = read("./WorkorderDetailLayout.jsx");
const shell = read("./WorkorderPanelShell.jsx");
const page = read("../../features/workorder-detail/WorkorderDetailPage.jsx");
const css = read("./workorder-object-page.css");
const layoutCss = read("./legacy-workorder-layout.css");
const toolbarCss = read("../../features/workorder-detail/workorder-detail-toolbar.css");

test("office tools use the existing pointer and keyboard splitter with independent saved sizing", () => {
  assert.match(shell, /tools=\{detail && onePage\}/);
  assert.match(layout, /tools \? WORKORDER_TOOLS_LAYOUT : WORKORDER_EDITOR_LAYOUT/);
  assert.match(layout, /storageKey: "workorder.toolsPreviewPercent.v1"/);
  assert.match(layout, /onPointerDown=\{startResize\}/);
  assert.match(layout, /onKeyDown=\{resizeWithKeyboard\}/);
  assert.match(layout, /minControlWidth: 620,[\s\S]*minPreviewWidth: 360/);
  assert.match(css, /\.split-layout\.workorder-detail-layout\.has-tools-layout\s*\{[^}]*grid-template-columns:\s*minmax\(620px, 1fr\) var\(--detail-resizer-width\) minmax\(0, var\(--preview-pane-width\)\);/s);
  assert.doesNotMatch(css, /workorder-detail-layout:has\(> \.workorder-tools-panel-overlay\[data-open\]\)/);
});

test("compact tools preserve desktop sizing and Chat lives only in the tools panel", () => {
  assert.match(layout, /if \(tools && window.innerWidth < 1280\) return/);
  assert.match(css, /\.has-tools-layout > \.detail-pane-resizer \{ display: none; \}/);
  assert.match(page, /previewOpen=\{isOfficeDetail \? officeToolsOpen/);
  assert.match(page, /id: "chat", label: chatPolicy.canRead \? "Chat" : "Notes"/);
  assert.match(page, /isOfficeDetail \? officeToolsOpen && officeToolView === "chat"/);
  assert.doesNotMatch(page, /workorder-inline-chat/);
});

test("Tools and its toggle use state transitions that respect reduced motion", () => {
  assert.match(layoutCss, /\.split-layout\.workorder-detail-layout\.has-tools-layout\s*\{\s*transition:\s*none;/);
  assert.match(toolbarCss, /\.preview-pane-toggle svg\s*\{[^}]*transition:\s*transform 300ms var\(--motion-ease-standard\);[^}]*transform:\s*rotate\(0deg\);/s);
  assert.match(toolbarCss, /\.preview-pane-toggle\.is-open svg\s*\{\s*transform:\s*rotate\(180deg\);/);
  assert.doesNotMatch(toolbarCss, /preview-toggle-close|preview-toggle-open/);
  assert.match(toolbarCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.preview-pane-toggle svg\s*\{\s*transition:\s*none;/s);
});
