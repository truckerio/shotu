import assert from "node:assert/strict";
import test from "node:test";
import { renderWorkorderPagesHtml, workorderQuantityTotals } from "./workorder-template.js";

test("flat service prints an each quantity and matching labor total", () => {
  const form = {
    laborHours: "2",
    laborProduct: { productId: "inspection", name: "Annual inspection", uomCode: "ea" },
    parts: [],
  };
  const html = renderWorkorderPagesHtml(form, "WO-SERVICE-1");
  assert.match(html, /Annual inspection/);
  assert.match(html, />2 ea</);
  assert.match(html, /Total Labor:<strong>2 ea<\/strong>/);
  assert.equal(workorderQuantityTotals(form).labor, "2 ea");
});

test("legacy labor without a unit remains hourly", () => {
  const form = { laborHours: "1.5", laborProduct: { name: "Shop labor" } };
  assert.equal(workorderQuantityTotals(form).labor, "1.5 hr");
});
