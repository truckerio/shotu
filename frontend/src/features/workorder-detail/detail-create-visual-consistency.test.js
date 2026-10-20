import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailPage = readFileSync(new URL("./WorkorderDetailPage.jsx", import.meta.url), "utf8");
const toolbarCss = readFileSync(new URL("./workorder-detail-toolbar.css", import.meta.url), "utf8");
const usedPartsCss = readFileSync(new URL("../../components/workorders/used-parts-editor.css", import.meta.url), "utf8");

test("one-page Detail keeps its identity and shared status actions on the Create-sized frosted header", () => {
  assert.match(detailPage, /subtitle: activeWorkorder\.workorder\.serial/);
  assert.match(detailPage, /status: <>[\s\S]*<WorkorderActivityStatus controller=\{workLog\} lifecycleStatus=\{detailStatus\}/);
  assert.match(detailPage, /className="detail-save-button"/);
  assert.match(detailPage, /<WorkDoneButton/);
  assert.match(toolbarCss, /\.workorder-detail-page \.control-panel > \.detail-context-bar\s*\{[^}]*box-shadow: 0 4px 12px rgb\(16 24 40 \/ 6%\);/s);
  assert.match(toolbarCss, /@supports[\s\S]*backdrop-filter: blur\(12px\)/);
  assert.match(toolbarCss, /data-workorder-presentation="one-page"[^}]*\.detail-context-bar h1\s*\{[^}]*font-size: 24px;[^}]*font-weight: var\(--weight-medium, 500\);[^}]*line-height: 30px;/s);
  assert.match(toolbarCss, /data-workorder-presentation="one-page"[^}]*\.detail-context-actions > \.button\s*\{[^}]*height: 40px;[^}]*min-height: 40px;/s);
});

test("one-page Detail parts align nested headings, row controls, and Add-part whitespace with Create", () => {
  const onePageOwner = /:is\(\.used-parts-editor\.is-one-page, \.control-panel\[data-workorder-presentation="one-page"\] \.used-parts-editor\)/;
  assert.match(usedPartsCss, new RegExp(`${onePageOwner.source} \\.used-parts-section\\s*\\{[^}]*gap: 12px;`, "s"));
  assert.match(usedPartsCss, new RegExp(`${onePageOwner.source} :is\\(\\.used-parts-section > h3, \\.used-parts-section-heading > h3\\)\\s*\\{[^}]*font-size: 15px;[^}]*line-height: 1\\.35;`, "s"));
  assert.match(usedPartsCss, new RegExp(`${onePageOwner.source} :is\\([\\s\\S]*\\.quantity-unit-number input,[\\s\\S]*\\.used-part-repair \\.narrative-field-control,[\\s\\S]*\\.used-parts-manual-picker \\.part-catalog-field > input[\\s\\S]*\\)\\s*\\{[^}]*min-height: 40px;`, "s"));
  assert.match(usedPartsCss, new RegExp(`${onePageOwner.source} \\.used-parts-actions\\s*\\{[^}]*padding-bottom: 16px;`, "s"));
});

test("one-page header controls retain 44px phone targets", () => {
  assert.match(toolbarCss, /@media screen and \(max-width: 700px\)[\s\S]*data-workorder-presentation="one-page"[\s\S]*\.detail-context-actions > \.button[\s\S]*height: 44px;[\s\S]*min-height: 44px;/s);
});

test("phone Create and Detail shells contain focus scrolling without changing the inner scroll owner", () => {
  assert.match(toolbarCss, /@media screen and \(max-width: 700px\)[\s\S]*html:has\(\.prototype\.workorder-detail-page\),[\s\S]*body:has\(\.prototype\.workorder-detail-page\),[\s\S]*#root:has\(\.prototype\.workorder-detail-page\)\s*\{[^}]*height: 100%;[^}]*overflow: clip;/s);
  assert.match(toolbarCss, /@media screen and \(max-width: 700px\)[\s\S]*\.prototype\.workorder-detail-page\s*\{[^}]*inset: 0;[^}]*overflow: clip;[^}]*position: fixed;[^}]*width: 100%;/s);
  assert.match(toolbarCss, /@media screen and \(max-width: 700px\)[\s\S]*\.prototype\.workorder-detail-page > \.split-layout\s*\{[^}]*overflow: clip;/s);
  assert.doesNotMatch(toolbarCss, /@media screen and \(max-width: 700px\)[\s\S]*\.prototype\.workorder-detail-page\s*\{[^}]*overflow(?:-y)?:\s*(?:auto|scroll)/s);
});
