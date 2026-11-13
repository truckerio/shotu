import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getPool, closePool } from "../../src/server/db/pool.js";
import { permissionsForRole } from "../../src/server/auth/permissions.js";
import { readBusinessSetup, writeBusinessSetup } from "../../src/server/modules/business-setup/business-setup.service.js";
import { seedMaintenanceFixture } from "./inspection-maintenance-fixture.js";
import { seedWorkorderDocumentsFixture } from "./workorder-documents-fixture.js";

const enabled = process.env.RUN_INSPECTION_MAINTENANCE_INTEGRATION === "1";
test("business setup persists independently, retries once, serializes concurrent edits and preserves billing history", { skip: !enabled }, async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/inspection_maintenance_test_[a-f0-9]{32}$/);
  const pool = getPool();
  try {
    const f = await seedMaintenanceFixture(pool);
    await pool.query("update user_company_memberships set company_id=$2,role='admin' where user_id=$1", [f.otherOfficeId, f.companyId]);
    await pool.query("insert into user_location_memberships(user_id,location_id,company_id) values($1,$2,$3)", [f.otherOfficeId, f.locationId, f.companyId]);
    const admin = { actor: { id: f.otherOfficeId, role: "admin" }, companyIds: new Set([f.companyId]), companyRoles: new Map([[f.companyId, "admin"]]), locationIds: new Set([f.locationId]), permissions: permissionsForRole("admin") };
    const scope = { companyId: f.companyId, locationId: f.locationId };
    assert.equal((await readBusinessSetup(admin, scope)).setup, null);
    const command = { ...scope, expectedVersion: 0, idempotencyKey: randomUUID(), operatingMode: "fleet_only", shopIdentity: { legalName: "QA Fleet", address: "100 Test Road", phone: "", email: "" }, step: 2, status: "completed" };
    const saved = await writeBusinessSetup(admin, command);
    assert.equal(saved.setup.version, 1);
    assert.equal(saved.billing.ready, false);
    assert.deepEqual((await writeBusinessSetup(admin, command)).setup, saved.setup);
    assert.equal(Number((await pool.query("select count(*) from business_setup_audit_events where company_id=$1", [f.companyId])).rows[0].count), 1);
    assert.equal(Number((await pool.query("select count(*) from customer_document_profiles where company_id=$1", [f.companyId])).rows[0].count), 0, "Fleet completion does not create a financial profile");
    const results = await Promise.allSettled(["A", "B"].map(name => writeBusinessSetup(admin, { ...command, expectedVersion: 1, idempotencyKey: randomUUID(), shopIdentity: { ...command.shopIdentity, legalName: name } })));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.find(result => result.status === "rejected").reason.statusCode, 409);
    await assert.rejects(writeBusinessSetup(admin, { ...command, shopIdentity: { ...command.shopIdentity, legalName: "Different" } }), error => error.statusCode === 409);
    const primaryAdminButOffice = { ...admin, companyRoles: new Map([[f.companyId, "office"]]) };
    await assert.rejects(readBusinessSetup(primaryAdminButOffice, scope), error => error.statusCode === 403);
    await assert.rejects(readBusinessSetup(admin, { ...scope, companyId: f.otherCompanyId }), error => error.statusCode === 403);
    await assert.rejects(pool.query("update business_setup_audit_events set setup='{}'::jsonb where company_id=$1", [f.companyId]), /immutable/);
    const documents = await seedWorkorderDocumentsFixture(pool, f);
    const before = await pool.query("select id,snapshot from customer_document_revisions where id=$1", [documents.revisionId]);
    const prior = await readBusinessSetup(admin, scope);
    assert.equal(prior.billing.ready, true);
    await writeBusinessSetup(admin, { ...command, expectedVersion: prior.setup.version, idempotencyKey: randomUUID(), operatingMode: "both" });
    assert.deepEqual((await pool.query("select id,snapshot from customer_document_revisions where id=$1", [documents.revisionId])).rows, before.rows);
  } finally { await closePool(); }
});
