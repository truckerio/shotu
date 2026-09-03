import assert from "node:assert/strict";
import test from "node:test";
import { inspectionRepositoryInternals } from "./inspections.repo.js";

const completed = {
  id: "inspection-1",
  company_id: "company-1",
  location_id: "location-1",
  inspection_number: "INS-1",
  status: "completed",
  result: "issues_found",
  completed_at: "2026-09-02T12:00:00.000Z",
  asset_snapshot: { unitNo: "T-1" },
  template_snapshot: { label: "Weekly Truck Inspection", sections: [] },
  final_notes: "",
};

function archivedWorkorderFlag(findings = [], workorderLinks = []) {
  return inspectionRepositoryInternals.archiveSnapshot(completed, [], findings, workorderLinks).snapshot.workordersLinked;
}

test("completed archive reports workorder links only when persisted link evidence exists", () => {
  assert.equal(archivedWorkorderFlag(), false, "a passed inspection has no workorder link");
  assert.equal(archivedWorkorderFlag([{ disposition: "office_follow_up" }]), false);
  assert.equal(archivedWorkorderFlag([{ disposition: "no_workorder" }]), false);
  assert.equal(archivedWorkorderFlag([{ disposition: "new_workorder" }]), false, "a disposition alone is not link evidence");
  assert.equal(archivedWorkorderFlag([{ disposition: "new_workorder" }], [{ finding_id: "finding-1" }]), true);
});
