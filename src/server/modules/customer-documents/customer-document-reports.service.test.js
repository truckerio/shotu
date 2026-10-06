import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRole } from "../../auth/permissions.js";
import { readCustomerDocumentReport } from "./customer-document-reports.service.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const context = () => ({ actor: { id: "33333333-3333-4333-8333-333333333333", role: "office" }, companyIds: new Set([companyId]), locationIds: new Set([locationId]), permissions: permissionsForRole("office") });

test("staff customer-document reporting stays location scoped and preserves currency groups", async () => {
  let command;
  const report = await readCustomerDocumentReport(context(), { companyId, locationId, grantLimit: "4" }, {
    now: "2026-09-30T00:00:00.000Z",
    readReport: async (input) => { command = input; return { documents: [{ documentType: "estimate", state: "accepted", currency: "USD", count: "2", totalAmount: "45.0000" }], grants: [] }; },
  });
  assert.equal(command.companyId, companyId);
  assert.equal(command.locationId, locationId);
  assert.equal(command.grantLimit, 4);
  assert.equal(report.documents[0].totalAmount, "45.0000");
  assert.equal(report.documents[0].count, 2);
  assert.equal(report.range.startAt, "2026-08-31T00:00:00.000Z");
});

test("reporting rejects cross-tenant scope and oversized ranges before repository reads", async () => {
  await assert.rejects(readCustomerDocumentReport(context(), { companyId: "44444444-4444-4444-8444-444444444444", locationId }, { readReport: async () => assert.fail("must not read") }), (error) => error.statusCode === 403);
  await assert.rejects(readCustomerDocumentReport(context(), { companyId, locationId, startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-06-01T00:00:00.000Z" }, { readReport: async () => assert.fail("must not read") }), (error) => error.code === "CUSTOMER_DOCUMENT_REPORT_RANGE_TOO_LARGE");
});
