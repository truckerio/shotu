import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { authorizedSummaryWorkorders } from "./inspection-api-model.js";

const detail = readFileSync(new URL("./InspectionDetail.jsx", import.meta.url), "utf8");
const experience = readFileSync(new URL("./InspectionExperience.jsx", import.meta.url), "utf8");

test("completed Summary deduplicates authorized linked workorders in creation order", () => {
  assert.deepEqual(authorizedSummaryWorkorders([
    { workorderId: "wo-2", workorderSerial: "WO-0002", createdAt: "2026-09-03T10:00:00.000Z" },
    { workorderId: "wo-1", workorderSerial: "WO-0001", createdAt: "2026-09-03T09:00:00.000Z" },
    { workorderId: "wo-2", workorderSerial: "WO-0002", createdAt: "2026-09-03T11:00:00.000Z" },
    { workorderId: "wo-3", workorderSerial: "", createdAt: "2026-09-03T12:00:00.000Z" },
  ]), [
    { id: "wo-1", number: "WO-0001" },
    { id: "wo-2", number: "WO-0002" },
  ]);
});

test("completed Summary exposes only neutral workorder text when identities are unavailable", () => {
  assert.deepEqual(authorizedSummaryWorkorders([
    { workorderId: "wo-1", workorderSerial: "" },
    { workorderId: "", workorderSerial: "WO-0002" },
  ]), []);
});

test("completed Summary retains the API order when links do not include timestamps", () => {
  assert.deepEqual(authorizedSummaryWorkorders([
    { workorderId: "wo-2", workorderSerial: "WO-0002" },
    { workorderId: "wo-1", workorderSerial: "WO-0001" },
  ]), [
    { id: "wo-2", number: "WO-0002" },
    { id: "wo-1", number: "WO-0001" },
  ]);
});

test("completed Summary owns number-only workorder links and does not leak linked-record metadata", () => {
  assert.match(detail, /inspection\.status === "completed" && summaryWorkorders\.length/);
  assert.match(detail, /<dt>Workorders<\/dt>/);
  assert.match(detail, /aria-label=\{`Open workorder \$\{workorder\.number\}`\}/);
  assert.match(detail, />\{workorder\.number\}<\/a>/);
  assert.match(detail, /summaryWorkorders\.length === 0 && \(inspection\.workordersLinked \|\| inspection\.workorderLinks\?\.length\)/);
  assert.match(detail, />Workorder linked</);
  assert.doesNotMatch(detail, /summaryWorkorders[\s\S]{0,500}workorderStatus/);
  assert.doesNotMatch(detail, /summaryWorkorders[\s\S]{0,500}concern/);
});

test("workorder activation uses the caller-owned route contract with inspection return context", () => {
  assert.match(detail, /onOpenWorkorder\(workorder\.id\)/);
  assert.match(detail, /href=\{workorderDetailSearch\(workorder\.id, "", \{ inspectionReturn: \{ from: "inspection", inspectionId: inspection\.id, anchor: "summary" \} \}\)\}/);
  assert.match(experience, /onOpenWorkorder/);
  assert.match(experience, /onOpenWorkorder=\{onOpenWorkorder \? \(workorderId\) => onOpenWorkorder\(workorderId, \{ from: "inspection", inspectionId: active\.id, anchor: "summary" \}\) : null\}/);
});
