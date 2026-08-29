import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./OperationalCollectionPage.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./operational-collection-page.css", import.meta.url), "utf8");

test("operational collection template owns page, tabs, toolbar, result, and table composition", () => {
  assert.match(component, /export function OperationalCollectionPage/);
  assert.match(component, /export function OperationalCollectionTabs/);
  assert.match(component, /export function OperationalCollectionToolbar/);
  assert.match(component, /export function OperationalCollectionResultHeader/);
  assert.match(component, /export function OperationalCollectionTable/);
  assert.match(component, /export function OperationalCollectionRow/);
  assert.match(component, /export function OperationalCollectionCell/);
  assert.match(styles, /\.operational-collection-page-body\s*\{[^}]*margin-top:\s*24px;/s);
  assert.match(styles, /\.operational-collection-table\s*\{[^}]*border-bottom:\s*1px solid #d0d5dd;/s);
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
