import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const footer = readFileSync(new URL("./WorkorderPricingFooter.jsx", import.meta.url), "utf8");
const summary = readFileSync(new URL("./WorkorderPricingSummary.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./workorder-pricing-footer.css", import.meta.url), "utf8");

test("shared pricing footer keeps the four-row hierarchy and a non-interactive discount fallback", () => {
  assert.match(footer, /label="Parts & labor"[\s\S]*\{discountControl \|\| <PricingRow label="Discount"[\s\S]*label="Tax"[\s\S]*label="Total"/);
  assert.match(footer, /export function WorkorderPricingFooter\(\{ pricing, projection = null, discountControl = null, message = "" \}\)/);
  assert.match(footer, /placeholder=\{view\.partsLabor === "—"\}/);
  assert.match(footer, /placeholder=\{view\.tax === "—"\}/);
  assert.match(footer, /placeholder=\{view\.total === "—"\}/);
});

test("legacy summary is a compatibility wrapper around the shared footer", () => {
  assert.match(summary, /export function WorkorderPricingSummary\(\{ pricing, projection = null, discountControl = null, message = "" \}\)/);
  assert.match(summary, /const summaryMessage = message \|\| \(!projection\?\.financialFingerprint/);
  assert.match(summary, /<WorkorderPricingFooter[\s\S]*pricing=\{pricing\}[\s\S]*projection=\{projection\}[\s\S]*discountControl=\{discountControl\}[\s\S]*message=\{summaryMessage\}/);
});

test("shared styles use normal-weight placeholders and a larger divided Total", () => {
  assert.match(css, /\.workorder-pricing-footer-row strong\.is-placeholder\s*\{\s*font-weight: 400;/);
  assert.match(css, /\.workorder-pricing-footer-row\.is-total\s*\{[^}]*border-top:[^;]+;[^}]*font-size: 18px;[^}]*margin-top: 12px;[^}]*padding-top: 12px;/s);
});
