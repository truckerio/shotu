import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getNextWorkorderToolView, getVisibleWorkorderToolViews } from "./workorder-tools-panel-model.js";

const source = readFileSync(new URL("./WorkorderToolsPanel.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./workorder-tools-panel.css", import.meta.url), "utf8");

test("only the modal tools header needs a close button; desktop uses the page toggle", () => {
  assert.match(source, /!isDesktop && \([\s\S]*aria-label="Close work order tools"/);
  assert.match(source, /<ToolsPanelHeader onClose=\{close\} isDesktop=\{isDesktop\}/);
});

test("tool tabs support cyclic arrow navigation plus Home and End", () => {
  const viewIds = ["preview", "chat", "activity"];
  assert.equal(getNextWorkorderToolView(viewIds, "preview", "ArrowLeft"), "activity");
  assert.equal(getNextWorkorderToolView(viewIds, "activity", "ArrowRight"), "preview");
  assert.equal(getNextWorkorderToolView(viewIds, "chat", "Home"), "preview");
  assert.equal(getNextWorkorderToolView(viewIds, "chat", "End"), "activity");
  assert.equal(getNextWorkorderToolView(viewIds, "chat", "Enter"), null);
});

test("completion is contextual: it is available only while selected", () => {
  const views = [
    { id: "preview", label: "Preview" },
    { id: "completion", label: "Review" },
    { id: "chat", label: "Chat" },
  ];
  assert.deepEqual(getVisibleWorkorderToolViews(views, "chat").map(({ id }) => id), ["preview", "chat"]);
  assert.deepEqual(getVisibleWorkorderToolViews(views, "completion").map(({ id }) => id), ["preview", "completion", "chat"]);
});

test("every supplied view stays mounted while inactive and tabs have the ARIA contract", () => {
  assert.match(source, /views\.map\(\(view\) => \([\s\S]*role="tabpanel"[\s\S]*hidden=\{selectedView !== view\.id\}/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /aria-selected=\{selectedView === view\.id\}/);
  assert.match(source, /aria-controls=\{`\$\{panelId\}-view-\$\{view\.id\}`\}/);
  assert.match(source, /data-open=\{open \|\| undefined\}/);
  assert.doesNotMatch(source, /if \(!open\) return null/);
});

test("the persistent native dialog supplies modal focus behavior and desktop receives a dock", () => {
  assert.match(source, /<dialog/);
  assert.match(source, /dialog\.showModal\(\)/);
  assert.match(source, /dialog\.show\(\)/);
  assert.match(source, /onCancel=\{handleCancel\}/);
  assert.match(source, /event\.key === "Escape" && !event\.defaultPrevented/);
  assert.match(css, /@media \(max-width: 1279px\)/);
  assert.match(css, /@media \(min-width: 1280px\)[\s\S]*width: 100%;/);
  assert.doesNotMatch(css, /width: 420px/);
  assert.match(css, /\.workorder-tools-panel::backdrop/);
  assert.match(css, /\.workorder-tools-panel-view\s*\{[\s\S]*overflow-y: auto;/);
});

test("the chat composer keeps a comfortable inset from the viewport edge", () => {
  assert.match(css, /\.workorder-tools-panel-view:has\(> \.chat-content\)\s*\{[^}]*padding-bottom:\s*24px;/s);
});
