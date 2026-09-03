import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detail = readFileSync(new URL("./InspectionDetail.jsx", import.meta.url), "utf8");
const experience = readFileSync(new URL("./InspectionExperience.jsx", import.meta.url), "utf8");

test("cancellation is role-gated, reasoned, confirmed, and excludes completed evidence", () => {
  assert.match(detail, /canCancel/);
  assert.match(detail, /Cancel inspection/);
  assert.match(detail, /Confirm cancellation/);
  assert.match(detail, /Saved responses remain audit evidence/);
  assert.match(detail, /minLength="2"/);
  assert.match(detail, /\["requested", "assigned", "in_progress"\]\.includes\(inspection\.status\)/);
  assert.match(experience, /\/actions\/cancel/);
  assert.match(experience, /expectedVersion: current\.version/);
  assert.match(experience, /await load\(\)/);
});
