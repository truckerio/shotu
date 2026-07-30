import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("./SurveillanceWorkspace.jsx", import.meta.url), "utf8");

test("Surveillance keeps Odoo mutation controls behind Manager approval", () => {
  assert.match(workspace, /const canProcessOdoo = \["closed", "odoo_entered"\]\.includes\(workorder\.status\)/);
  assert.match(workspace, /\{canProcessOdoo \? \([\s\S]*?<form className="surveillance-odoo-form"[\s\S]*?: \([\s\S]*?Awaiting office approval/);
});

test("Surveillance uses explicit request and correction handoff language", () => {
  assert.match(workspace, />Information requested</);
  assert.match(workspace, />Manager update received</);
  assert.match(workspace, />Waiting for a Manager correction or addendum\.</);
  assert.match(workspace, />Request information</);
  assert.doesNotMatch(workspace, />Send back for information</);
});
