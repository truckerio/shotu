import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const approveButton = readFileSync(new URL("./ApproveButton.jsx", import.meta.url), "utf8");
const controls = readFileSync(new URL("../forms/legacy-form-controls.css", import.meta.url), "utf8");
const detailPage = readFileSync(new URL("../../features/workorder-detail/WorkorderDetailPage.jsx", import.meta.url), "utf8");
const completionModule = readFileSync(new URL("../../features/workorder-modules/completion/WorkorderCompletionModule.jsx", import.meta.url), "utf8");
const officeRequestCard = readFileSync(new URL("./part-requests/OfficeRequestCard.jsx", import.meta.url), "utf8");

test("shared Approve action owns its success color, icon, and busy state", () => {
  assert.match(approveButton, /variant="success"/);
  assert.match(approveButton, /icon=\{CheckCircle\}/);
  assert.match(approveButton, /disabled=\{disabled \|\| busy\}/);
  assert.match(controls, /\.button\.success\s*\{[^}]*background:\s*#067647;[^}]*border-color:\s*#067647;[^}]*color:\s*#fff;/s);
});

test("every interactive approval surface uses the shared Approve action", () => {
  assert.equal((detailPage.match(/<ApproveButton/g) || []).length, 2);
  assert.match(completionModule, /allowedActions\.approve \? <ApproveButton/);
  assert.match(officeRequestCard, /<ApproveButton/);
  assert.doesNotMatch(completionModule, /<Button[^>]*>\s*<CheckCircle \/>Approve/);
});
