import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailViewModel = readFileSync(new URL("../../app/routes/useWorkorderDetailViewModel.js", import.meta.url), "utf8");
const detail = readFileSync(new URL("./WorkorderDetailPage.jsx", import.meta.url), "utf8");

test("detail lifecycle and dates use the shared presentation registry", () => {
  assert.match(detailViewModel, /formatLifecycleLabel\(detailStatus/);
  assert.doesNotMatch(detailViewModel, /value: "in_progress", label: "Working"/);
  assert.match(detail, /formatUiDateRange\(form\.workStartDate, form\.workEndDate, \{ locale \}\)/);
});
