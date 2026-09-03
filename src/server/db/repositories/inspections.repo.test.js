import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createInspectionWorkorder, inspectionRepositoryInternals } from "./inspections.repo.js";

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

test("inspection queue summary reports persisted answer progress", () => {
  const summary = inspectionRepositoryInternals.publicSummary({
    id: "inspection-1",
    version: 3,
    answered_count: "12",
    defect_count: "1",
    template_snapshot: { sections: [{ items: [{ key: "a" }, { key: "b" }] }] },
  });
  assert.deepEqual(summary.progress, { answered: 12, total: 2, issues: 1 });
});

test("inspection completion gives its shared service-history identifier one PostgreSQL type", async () => {
  const source = await readFile(new URL("inspections.repo.js", import.meta.url), "utf8");
  assert.match(source, /values\(\$1,'local_inspection',\$2::uuid::text,[\s\S]*'verified_completed',\$2::uuid\)/);
  assert.doesNotMatch(source, /values\(\$1,'local_inspection',\$2,\$3,[\s\S]*'verified_completed',\$2::uuid\)/);
});

test("inspection completion gives shared service-history line ordering one PostgreSQL type", async () => {
  const source = await readFile(new URL("inspections.repo.js", import.meta.url), "utf8");
  assert.match(source, /values\(\$1,\$2,\$3,\$4::integer::numeric,\$4::integer,'service'/);
  assert.doesNotMatch(source, /values\(\$1,\$2,\$3,\$4,\$4,'service'/);
});

test("inspection workorder creation maps the one-active-unit constraint to a public conflict", async () => {
  const activeConflict = Object.assign(new Error("Asset already has an active workorder."), {
    code: "23505",
    constraint: "operational_workorders_one_active_per_asset_uidx",
  });
  const inspection = {
    id: "22222222-2222-4222-8222-222222222222",
    company_id: "11111111-1111-4111-8111-111111111111",
    location_id: "33333333-3333-4333-8333-333333333333",
    asset_id: "44444444-4444-4444-8444-444444444444",
    inspection_number: "INS-1",
    status: "in_progress",
    version: 2,
    asset_snapshot: {},
  };
  const client = {
    async query(sql) {
      if (sql === "rollback" || sql === "begin" || sql.startsWith("select pg_advisory")) return { rows: [] };
      if (sql.includes("from inspections inspection")) return { rows: [inspection] };
      if (sql.includes("from inspection_workorder_create_commands")) return { rows: [] };
      if (sql.startsWith("select * from inspection_findings")) return { rows:[{ id:"55555555-5555-4555-8555-555555555555", disposition:"new_workorder", note:"Tire damage" }], rowCount:1 };
      if (sql.startsWith("select 1 from inspection_workorder_links")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  };
  await assert.rejects(createInspectionWorkorder({
    inspectionId:inspection.id,
    companyIds:[inspection.company_id],
    expectedVersion:2,
    findingIds:["55555555-5555-4555-8555-555555555555"],
    actorId:"66666666-6666-4666-8666-666666666666",
    idempotencyKey:"inspection-create-active-conflict",
  }, {
    pool:{ connect:async()=>client },
    createWorkorder:async()=>{ throw activeConflict; },
  }), (error) => error.statusCode === 409
    && error.code === "ASSET_ACTIVE_WORKORDER_EXISTS"
    && /already has an active workorder/i.test(error.message));
});
