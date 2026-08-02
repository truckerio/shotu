import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const router = readFileSync(new URL("../../app/routes/RoleRouter.jsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("./WorkorderDetailPage.jsx", import.meta.url), "utf8");

test("detail lifecycle and dates use the shared presentation registry", () => {
  assert.match(router, /formatLifecycleLabel\(detailStatus/);
  assert.doesNotMatch(router, /value: "in_progress", label: "Working"/);
  assert.match(detail, /formatUiDateRange\(form\.workStartDate, form\.workEndDate, \{ locale \}\)/);
});
