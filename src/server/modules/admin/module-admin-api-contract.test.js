import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = await readFile(new URL("../../routes/admin.routes.js", import.meta.url), "utf8");
const docs = await readFile(new URL("../../../../docs/api/WORKORDER_MODULE_ADMIN_API.md", import.meta.url), "utf8");
const server = await readFile(new URL("../../../../server.js", import.meta.url), "utf8");

test("approved Admin module API names match canonical and bulk-save routes", () => {
  for (const contract of ["/api/admin/module-access", "/api/admin/module-catalog", "/module-policy", "/workorder-policy"]) {
    assert.match(routes, new RegExp(contract.replaceAll("/", "\\/")));
    assert.match(docs, new RegExp(contract.replaceAll("/", "\\/")));
  }
});

test("policy PATCH routes pass request correlation through the audit-owner seam", () => {
  assert.match(routes, /emitAdministrativeAuditEvent/);
  assert.equal((routes.match(/emitAuditEvent: emitAdministrativeAuditEvent/g) || []).length, 4);
  assert.equal((routes.match(/requestId: req\.requestId \|\| null/g) || []).length, 4);
  assert.match(server, /emitAdministrativeAuditEvent: emitStructuredEvent/);
});
