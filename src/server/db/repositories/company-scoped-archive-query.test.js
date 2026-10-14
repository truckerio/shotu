import assert from "node:assert/strict";
import test from "node:test";
import { findScopedWorkorderPrintArchive, listScopedWorkorderPrintArchives } from "./workorder-print-archives.repo.js";
import { getStaffCustomerDocumentRevision } from "./customer-documents.repo.js";

test("archive and financial revision queries use per-company admin predicates", async () => {
  const scope = { companyIds: ["A", "B"], adminCompanyIds: ["A"], isAdmin: true, locationIds: ["B-assigned"] };
  const calls = [];
  const query = async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; };
  await findScopedWorkorderPrintArchive({ ...scope, archiveId: "archive" }, { query });
  await listScopedWorkorderPrintArchives(scope, { query });
  await getStaffCustomerDocumentRevision({ ...scope, revisionId: "revision" }, { query });
  for (const { sql } of calls) {
    assert.match(sql, /company_id\s*=\s*any\(\$\d+::uuid\[\]\)\s+or\s+(?:revision\.)?location_id/);
    assert.doesNotMatch(sql, /::boolean/);
  }
  assert.deepEqual(calls[0].params[2], ["A"]);
  assert.deepEqual(calls[1].params[1], ["A"]);
  assert.deepEqual(calls[2].params[2], ["A"]);
});
