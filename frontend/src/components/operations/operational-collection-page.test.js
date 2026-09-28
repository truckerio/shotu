import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./OperationalCollectionPage.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./operational-collection-page.css", import.meta.url), "utf8");

test("operational collection template owns page, tabs, toolbar, result, and table composition", () => {
  assert.match(component, /export function OperationalCollectionPage/);
  assert.match(component, /const hasHeader = Boolean\(\(showTitle && title\) \|\| subtitle \|\| leading \|\| actions\)/);
  assert.match(component, /\{hasHeader \? <PageHeader/);
  assert.match(component, /showTitle=\{showTitle\}/);
  assert.match(component, /surface && "operational-collection-surface"/);
  assert.match(component, /export function OperationalCollectionTabs/);
  assert.match(component, /export function OperationalCollectionSectionHeader/);
  assert.match(component, /export function OperationalCollectionToolbar/);
  assert.match(component, /export function OperationalCollectionResultHeader/);
  assert.match(component, /export function OperationalCollectionTable/);
  assert.match(component, /export function OperationalCollectionRow/);
  assert.match(component, /export function OperationalCollectionCell/);
  assert.match(styles, /\.operational-collection-page-body\s*\{[^}]*margin-top:\s*var\(--space-6\);/s);
  assert.match(styles, /\.operational-collection-surface\s*\{[^}]*border:\s*1px solid #e4e7ec;[^}]*border-radius:\s*12px;[^}]*box-shadow:/s);
  assert.match(styles, /\.operational-collection-table\s*\{[^}]*border-bottom:\s*1px solid #d0d5dd;/s);
});

test("operational section header promotes the active view and keeps peers as navigation", () => {
  assert.match(component, /const activeItem = items\.find\(\(item\) => item\.id === activeId\) \|\| items\[0\]/);
  assert.match(component, /const Heading = headingLevel === 2 \? "h2" : "h1"/);
  assert.match(component, /\{showHeading \? <Heading>\{activeItem\?\.label\}<\/Heading> : null\}/);
  assert.match(component, /!showHeading && "is-heading-external"/);
  assert.match(component, /items\.filter\(\(item\) => item\.id !== activeItem\?\.id\)\.map/);
  assert.match(component, /className="operational-collection-section-nav" aria-label=\{ariaLabel\}/);
  assert.match(component, /operational-collection-section-actions page-header-actions/);
  assert.match(styles, /\.operational-collection-section-actions\s*\{[^}]*align-self:\s*center;/s);
  assert.match(styles, /\.operational-collection-section-nav button\s*\{[^}]*font-size:\s*var\(--text-body\);[^}]*font-weight:\s*var\(--weight-semibold\);/s);
  assert.match(styles, /\.operational-collection-section-header\s*\{[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto;/s);
  assert.match(styles, /\.operational-collection-section-header :is\(h1, h2\)\s*\{[^}]*color: var\(--foreground-brand-primary, #175cd3\);/s);
  assert.doesNotMatch(styles, /\.operational-collection-section-header :is\(h1, h2\)\s*\{[^}]*font-size:/s);
  assert.doesNotMatch(styles, /font-size:\s*22px;/);
  assert.doesNotMatch(styles, /@media \(max-width: 760px\)[\s\S]*?\.operational-collection-section-header :is\(h1, h2\)/);
});

test("operational collection template keeps page and embedded heading semantics separate", () => {
  assert.match(component, /const embedded = presentation === "embedded"/);
  assert.match(component, /headingLevel=\{embedded \? 2 : 1\}/);
  assert.match(styles, /\.operational-collection-page\.is-embedded \.operational-collection-page-body/);
});

test("operational collection filters use button-group semantics instead of an incomplete tabs pattern", () => {
  assert.match(component, /className="operational-collection-tabs" role="group" aria-label=\{ariaLabel\}/);
  assert.match(component, /aria-pressed=\{activeId === item\.id\}/);
  assert.doesNotMatch(component, /role="tab(?:list)?"/);
  assert.doesNotMatch(component, /aria-selected=/);
});

test("operational collection rows expose keyboard activation and phone cards", () => {
  assert.match(component, /\["Enter", " "\]\.includes\(event\.key\)/);
  assert.match(component, /event\.target\.closest\?\.\("button, a, input, select, textarea/);
  assert.match(component, /tabIndex=\{onAction \? 0 : undefined\}/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.operational-collection-row\s*\{[^}]*border-radius:\s*10px;/s);
});
