import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./workorder-object-page.css", import.meta.url), "utf8");
test("one-page selection focus is a shared underline, without changing writing-field focus", () => {
  const rule = css.slice(css.indexOf("/* Selection focus belongs"), css.indexOf(".workorder-one-page-location-row .operational-form-field-error"));
  for (const control of [".labor-product-control:focus-within", ".create-schedule-one-page-range:focus-within", ".dropdown-select-trigger:focus", ".quantity-unit-trigger:focus", "#workorder-unit:focus", "#customer-company-name:focus", ".part-catalog-field > input:focus", ".create-assignment-one-page-dropdown:focus-within"]) assert.ok(rule.includes(control), control);
  assert.match(rule, /border-bottom: 1px solid #1570ef/);
  assert.match(rule, /box-shadow: 0 1px 0 #1570ef/);
  assert.match(rule, /outline: none/);
  assert.doesNotMatch(rule, /textarea|workorder-concern|repair-history-field-trigger/);
});
