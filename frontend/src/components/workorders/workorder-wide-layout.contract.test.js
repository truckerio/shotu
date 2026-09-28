import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./workorder-form-layout.css", import.meta.url), "utf8");
const objectCss = readFileSync(new URL("./workorder-object-page.css", import.meta.url), "utf8");
const toolbarCss = readFileSync(new URL("../../features/workorder-detail/workorder-detail-toolbar.css", import.meta.url), "utf8");
const layoutCss = readFileSync(new URL("./legacy-workorder-layout.css", import.meta.url), "utf8");
const toolsCss = readFileSync(new URL("./workorder-tools-panel.css", import.meta.url), "utf8");
const detailCss = readFileSync(new URL("../../styles/workorder-detail.css", import.meta.url), "utf8");

test("one-page office forms share a bounded elevated wide-screen surface", () => {
  assert.match(css, /@media \(min-width: 1440px\)[\s\S]*?--workorder-wide-form-width:\s*1280px/s);
  assert.match(css, /\.workorder-form-layout\s*\{[^}]*background:\s*#fff;[^}]*border:\s*1px solid #e4e7ec;[^}]*border-radius:\s*12px;[^}]*box-shadow:\s*0 8px 24px rgb\(16 24 40 \/ 8%\);[^}]*max-width:\s*var\(--workorder-wide-form-width\);[^}]*width:\s*calc\(100% - 48px\);/s);
  assert.match(css, /> \.workorder-one-page-notices:not\(:empty\)\s*\{[^}]*max-width:\s*var\(--workorder-wide-form-width\);[^}]*width:\s*calc\(100% - 48px\);/s);
  assert.doesNotMatch(css, /> :is\(\.detail-context-bar,/);
});

test("wide Detail surface remains bounded while Tools opens, while Create preview still yields", () => {
  assert.match(css, /\.split-layout:is\(:not\(\.has-preview\), \.workorder-detail-layout\.has-tools-layout\)/);
  assert.doesNotMatch(css, /:not\(:has\(> \.workorder-tools-panel-overlay\[data-open\]\)\)/);
  assert.match(css, /\.workorder-form-layout\s*\{[^}]*overflow:\s*visible;/s);
});

test("Detail and Tools headers span their panes at the same height", () => {
  assert.match(detailCss, /\.workorder-detail-page \.detail-context-bar\s*\{[^}]*border-bottom:\s*1px solid #e4e7ec;[^}]*height:\s*62px;/s);
  assert.match(toolsCss, /\.workorder-tools-panel-header\s*\{[^}]*border-bottom:\s*1px solid #e4e7ec;[^}]*box-sizing:\s*border-box;[^}]*height:\s*62px;/s);
  assert.doesNotMatch(css, /\.detail-context-bar/);
});

test("the desktop split uses one vertical divider", () => {
  assert.match(layoutCss, /\.detail-pane-resizer::before\s*\{[^}]*background:\s*#e1e4e8;[^}]*width:\s*1px;/s);
  assert.doesNotMatch(toolsCss, /\.workorder-tools-panel\[open\]\s*\{[^}]*border-left:/s);
});

test("one-page Detail uses the same system surface as Tools", () => {
  assert.match(objectCss, /\.prototype\.workorder-detail-page:has\(\.control-panel\[data-workorder-presentation="one-page"\]\)\s*\{[^}]*background:\s*#fff;/s);
  assert.match(objectCss, /\.workorder-detail-page \.control-panel\[data-workorder-presentation="one-page"\]\s*\{[^}]*background:\s*#fff;/s);
  assert.match(objectCss, /\.control-panel\[data-workorder-presentation="one-page"\] \.workorder-one-page-stack\s*\{[^}]*background:\s*#fff;/s);
  assert.match(toolsCss, /\.workorder-tools-panel\s*\{[^}]*background:\s*#fff;/s);
});

test("workorder hierarchy and actions use the frozen type and control baseline", () => {
  assert.match(objectCss, /\.workorder-object-summary h1\s*\{[^}]*font-size:\s*24px;/s);
  assert.match(objectCss, /\.workorder-section-panel-heading h2\s*\{[^}]*font-size:\s*20px;/s);
  assert.match(objectCss, /\.workorder-section-more-menu \[role="menuitem"\]\s*\{[^}]*font-size:\s*14px;[^}]*font-weight:\s*var\(--weight-semibold\);/s);
  assert.match(toolbarCss, /\.detail-create-button\s*\{[^}]*font-size:\s*14px;[^}]*height:\s*40px;/s);
  assert.match(detailCss, /@media \(max-width: 700px\)[\s\S]*?\.workorder-detail-page \.workorder-context-main > button,[\s\S]*?flex:\s*0 0 44px;[\s\S]*?height:\s*44px;[\s\S]*?width:\s*44px;/s);
  assert.match(objectCss, /@media \(max-width: 700px\)[\s\S]*?\.workorder-unit-details-trigger\s*\{[^}]*height:\s*44px;/s);
});
