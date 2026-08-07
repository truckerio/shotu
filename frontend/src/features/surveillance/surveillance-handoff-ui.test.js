import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailPage = readFileSync(new URL("./workspace/SurveillanceDetailPage.jsx", import.meta.url), "utf8");
const odooPanel = readFileSync(new URL("./workspace/SurveillanceOdooPanel.jsx", import.meta.url), "utf8");
const detailController = readFileSync(new URL("./workspace/useSurveillanceDetail.js", import.meta.url), "utf8");

test("Surveillance keeps Odoo mutation controls behind Manager approval", () => {
  assert.match(detailPage, /const canProcessOdoo = \["closed", "odoo_entered"\]\.includes\(workorder\.status\)/);
  assert.match(odooPanel, /\{canProcessOdoo \? \([\s\S]*?<form className="surveillance-odoo-form"[\s\S]*?: \([\s\S]*?Awaiting office approval/);
});

test("Surveillance uses explicit request and correction handoff language", () => {
  assert.match(odooPanel, />Information requested</);
  assert.match(odooPanel, />Manager update received</);
  assert.match(odooPanel, />Waiting for a Manager correction or addendum\.</);
  assert.match(odooPanel, />Request information</);
  assert.doesNotMatch(odooPanel, />Send back for information</);
});

test("Surveillance can save labor before readiness becomes ready", () => {
  assert.match(odooPanel, /const canCreateDraft = Boolean\(String\(laborHours\)\.trim\(\) && !createdOrderNo\)/);
  assert.doesNotMatch(odooPanel, /const canCreateDraft = Boolean\(odooReadiness\?\.ready/);
});

test("Surveillance reports blocked draft attempts without flickering known readiness", () => {
  assert.match(odooPanel, /odooReadinessStatus\(\{[\s\S]*?created: Boolean\(createdOrderNo\),[\s\S]*?loading: odooLoading,[\s\S]*?readiness: odooReadiness/);
  assert.match(odooPanel, /className="surveillance-odoo-attempt" role="alert"/);
  assert.match(odooPanel, />Draft not created</);
  assert.match(detailController, /setOdooDraftFeedback\(odooDraftBlockedMessage\(readiness\)\)/);
});

test("Surveillance Preview overlays stale saved headings with the current location", () => {
  assert.match(detailPage, /import \{ canonicalDetailPreviewTemplate \}/);
  assert.match(
    detailPage,
    /\.\.\.formData,\s*\.\.\.canonicalDetailPreviewTemplate\(workorder\),/,
  );
});
