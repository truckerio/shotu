import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const button = readFileSync(new URL("./WorkDoneButton.jsx", import.meta.url), "utf8");
const detailPage = readFileSync(new URL("../../features/workorder-detail/WorkorderDetailPage.jsx", import.meta.url), "utf8");
const completionModule = readFileSync(new URL("../../features/workorder-modules/completion/WorkorderCompletionModule.jsx", import.meta.url), "utf8");

test("shared Work done action owns its icon, label, and busy state", () => {
  assert.match(button, /variant="primary"/);
  assert.match(button, /icon=\{CheckCircle\}/);
  assert.match(button, /disabled=\{disabled \|\| busy\}/);
  assert.match(button, /busy \? busyLabel : label/);
});

test("detail and completion surfaces use the shared Work done action", () => {
  assert.equal((detailPage.match(/<WorkDoneButton/g) || []).length, 2);
  assert.match(completionModule, /canMarkDone \? <WorkDoneButton/);
  assert.match(completionModule, /canMarkDone = allowedActions\.markDone === true/);
  assert.doesNotMatch(detailPage, /className="finish-work-button"/);
});
