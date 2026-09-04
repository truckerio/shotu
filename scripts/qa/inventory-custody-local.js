import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { auth } from "../../src/server/auth/auth.js";
import { closePool, getPool } from "../../src/server/db/pool.js";
import { createInventoryReuseFixture } from "../../src/server/modules/inventory/inventory-reuse.fixture.js";
import { redactQaError } from "./safety.js";
import { RoleApiClient } from "./e2e/api-client.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function requireLocalConfig(environment = process.env) {
  if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required for the local custody harness.");
  let databaseUrl;
  try { databaseUrl = new URL(environment.DATABASE_URL); } catch { throw new Error("DATABASE_URL must be a valid local PostgreSQL URL."); }
  if (!LOCAL_HOSTS.has(databaseUrl.hostname)) {
    throw new Error("DATABASE_URL must target localhost; remote and production databases are refused.");
  }
  const baseUrl = new URL(environment.QA_CUSTODY_BASE_URL || "http://localhost:4173");
  if (!LOCAL_HOSTS.has(baseUrl.hostname) || !["http:", "https:"].includes(baseUrl.protocol)) {
    throw new Error("QA_CUSTODY_BASE_URL must be an http(s) localhost URL; remote and production targets are refused.");
  }
  baseUrl.pathname = "/";
  baseUrl.search = "";
  baseUrl.hash = "";
  return { baseUrl, timeoutMs: Number(environment.QA_CUSTODY_REQUEST_TIMEOUT_MS || 15_000) };
}

function key(runId, action) { return `custody-${runId}-${action}`; }
function assertCase(result, expected, stage) {
  const custodyCase = result.body?.case;
  assert.equal(custodyCase?.status, expected, `${stage} returned ${custodyCase?.status || "no custody case"}.`);
  return custodyCase;
}
function assertCode(result, code, stage) {
  assert.equal(result.body?.code, code, `${stage} returned ${result.body?.code || "no error code"}.`);
}

async function disposeAll(clients) {
  const failures = (await Promise.allSettled(Object.values(clients).map((client) => client.dispose())))
    .filter((result) => result.status === "rejected").map((result) => result.reason);
  if (failures.length) throw new AggregateError(failures, "Unable to dispose custody API clients.");
}

async function provisionActor({ pool, profileId, role, label, runId, password }) {
  const username = `custody_${label}_${runId.slice(0, 12)}`.slice(0, 50);
  const email = `${username}@example.test`;
  const created = await auth.api.signUpEmail({ body: {
    name: `Custody QA ${label}`,
    email,
    password,
    username,
    displayUsername: username,
  } });
  const authUserId = created?.user?.id;
  if (!authUserId) throw new Error(`Better Auth did not create the ${label} fixture identity.`);
  const linked = await pool.query(
    `update user_profiles
        set display_name = $1, contact_email = $2, auth_user_id = $3, active = true,
            deleted_at = null, updated_at = now()
      where id = $4 and auth_user_id is null
      returning id`,
    [`Custody QA ${label}`, email, authUserId, profileId],
  );
  if (linked.rowCount !== 1) throw new Error(`Fixture profile for ${label} was unavailable or already linked.`);
  await pool.query(
    `update auth_user
        set auth_role = $1, banned = false, ban_reason = null, ban_expires = null, updated_at = now()
      where id = $2`,
    [role === "admin" ? "admin" : "user", authUserId],
  );
  return { profileId, authUserId, username, password };
}

async function removeProvisionedActors(pool, actors) {
  const failures = [];
  for (const actor of Object.values(actors)) {
    try {
      await pool.query("update user_profiles set auth_user_id = null, contact_email = null where id = $1", [actor.profileId]);
      await pool.query("delete from auth_user where id = $1", [actor.authUserId]);
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "Unable to remove generated custody identities.");
}

async function stockSnapshot(pool, fixture) {
  const result = await pool.query(
    `select item.quantity_on_hand::text as on_hand, item.quantity_reserved::text as reserved,
       (select count(*)::integer from inventory_stock_movements m
         where m.company_id = $1 and m.unit_id = $4 and m.movement_type = 'issue') as issues,
       (select count(*)::integer from inventory_stock_movements m
         where m.company_id = $1 and m.unit_id = $4 and m.movement_type = 'return') as returns,
       unit.status as unit_status, unit.receipt_id,
       receipt.invoice_run_id
      from inventory_items item
      join inventory_serialized_units unit on unit.company_id = item.company_id and unit.id = $4
      join inventory_receipts receipt on receipt.company_id = unit.company_id and receipt.id = unit.receipt_id
     where item.company_id = $1 and item.location_id = $2 and item.catalog_part_id = $3
       and item.source_provider = 'local'`,
    [fixture.companyId, fixture.locationId, fixture.catalogPartId, fixture.unitId],
  );
  assert.equal(result.rowCount, 1, "Expected one exact local stock snapshot.");
  return result.rows[0];
}

async function assertReissuedIdentity(pool, fixture, reuseUsageId) {
  const result = await pool.query(
    `select usage.unit_id, usage.asset_id, unit.receipt_id, receipt.invoice_run_id
       from workorder_serialized_part_usages usage
       join inventory_serialized_units unit on unit.company_id = usage.company_id and unit.id = usage.unit_id
       join inventory_receipts receipt on receipt.company_id = unit.company_id and receipt.id = unit.receipt_id
      where usage.company_id = $1 and usage.id = $2`,
    [fixture.companyId, reuseUsageId],
  );
  assert.deepEqual(result.rows[0], {
    unit_id: fixture.unitId,
    asset_id: fixture.secondAssetId,
    receipt_id: fixture.receiptId,
    invoice_run_id: fixture.invoiceRunId,
  }, "Reissue must preserve the exact serialized unit and its invoice lineage.");
}

export async function setupInventoryCustodyFixture({ environment = process.env, logger = console, password: suppliedPassword } = {}) {
  const config = requireLocalConfig(environment);
  const pool = getPool();
  const runId = randomUUID().replaceAll("-", "");
  const password = suppliedPassword === undefined ? randomBytes(30).toString("base64url") : String(suppliedPassword);
  if (password.length < 12 || password.length > 128 || /[\r\n]/.test(password)) {
    throw new Error("A supplied custody fixture password must contain 12-128 characters without line breaks.");
  }
  const fixture = await createInventoryReuseFixture({ installed: false, configured: false });
  const credentials = {};
  try {
    credentials.admin = await provisionActor({ pool, profileId: fixture.adminId, role: "admin", label: "admin", runId, password });
    credentials.receiver = await provisionActor({ pool, profileId: fixture.receiverId, role: "office", label: "receiver", runId, password });
    credentials.releaser = await provisionActor({ pool, profileId: fixture.releaseId, role: "office", label: "releaser", runId, password });
    const clients = {
      admin: await RoleApiClient.create({ role: "admin", baseUrl: config.baseUrl, timeoutMs: config.timeoutMs }),
      receiver: await RoleApiClient.create({ role: "office", baseUrl: config.baseUrl, timeoutMs: config.timeoutMs }),
      releaser: await RoleApiClient.create({ role: "office", baseUrl: config.baseUrl, timeoutMs: config.timeoutMs }),
    };
    try {
      await Promise.all(Object.entries(clients).map(([name, client]) => client.authenticate(credentials[name])));
    } catch (error) {
      try {
        await disposeAll(clients);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Inventory custody authentication and client cleanup failed.");
      }
      throw error;
    }
    logger.log(`[inventory-custody] fixture ready ${runId.slice(0, 12)}`);
    return {
      ...fixture,
      runId,
      clients,
      actors: Object.fromEntries(Object.entries(credentials).map(([name, actor]) => [name, {
        profileId: actor.profileId, authUserId: actor.authUserId, username: actor.username,
      }])),
      async cleanup() {
        const failures = [];
        try { await disposeAll(clients); } catch (error) { failures.push(error); }
        try { await removeProvisionedActors(pool, credentials); } catch (error) { failures.push(error); }
        try { await fixture.cleanup(); } catch (error) { failures.push(error); }
        if (failures.length) throw new AggregateError(failures, "Inventory custody fixture cleanup failed.");
      },
    };
  } catch (error) {
    const failures = [error];
    try { await removeProvisionedActors(pool, credentials); } catch (cleanupError) { failures.push(cleanupError); }
    try { await fixture.cleanup(); } catch (cleanupError) { failures.push(cleanupError); }
    if (failures.length > 1) throw new AggregateError(failures, "Inventory custody setup and cleanup failed.");
    throw error;
  }
}

export async function runInventoryCustodyLocal({ environment = process.env, logger = console } = {}) {
  const ready = await setupInventoryCustodyFixture({ environment, logger });
  const { clients, runId } = ready;
  const pool = getPool();
  const scope = { companyId: ready.companyId, locationId: ready.locationId };
  const originalWorkorderId = ready.originalWorkorderId || ready.workorderId;
  try {
    if (!originalWorkorderId || !ready.removalWorkorderId || !ready.secondWorkorderId || !ready.unitId) {
      throw new Error("The custody fixture is missing an active workorder or serialized unit identifier.");
    }
    await clients.admin.request("/api/inventory-reuse/config/grant", { method: "POST", body: { ...scope, userId: ready.adminId, capabilities: ["remove", "receive"], reason: "Local custody QA remover authorization and separation check." } });
    await clients.admin.request("/api/inventory-reuse/config/grant", { method: "POST", body: { ...scope, userId: ready.receiverId, capabilities: ["receive"], reason: "Local custody QA receiver authorization." } });
    await clients.admin.request("/api/inventory-reuse/config/grant", { method: "POST", body: { ...scope, userId: ready.releaseId, capabilities: ["release"], reason: "Local custody QA reviewer authorization." } });
    await clients.admin.request("/api/inventory-reuse/config/policy", { method: "POST", body: { ...scope, catalogPartId: ready.catalogPartId, reuseAllowed: true, evidence: "Local custody QA reusable-part policy." } });

    const issued = await clients.admin.request(`/api/workorders/${originalWorkorderId}/inventory-units/issue`, { method: "POST", expectedStatuses: [201], body: { unitId: ready.unitId, idempotencyKey: key(runId, "issue-a") } });
    const originalUsageId = issued.body?.usage?.id;
    assert.ok(originalUsageId, "Issuing the exact serialized unit did not return a usage id.");
    const installed = await clients.admin.request(`/api/workorders/${originalWorkorderId}/inventory-unit-usages/${originalUsageId}/finalize`, { method: "POST", body: { disposition: "installed", idempotencyKey: key(runId, "install-a") } });
    assert.equal(installed.body?.usage?.status, "installed_pending_approval", "Installation must await office approval.");
    await clients.admin.request(`/api/office/workorders/${originalWorkorderId}/mark-done`, { method: "POST", body: { diagnosis: "Custody QA installation verified.", workPerformed: "Installed serialized custody QA part.", confirmationName: "Custody QA Admin" } });
    const approved = await clients.admin.request(`/api/office/workorders/${originalWorkorderId}/close`, { method: "POST", body: { note: "Custody QA office approval." } });
    assert.equal(approved.body?.workorder?.status, "closed", "Office approval did not close the initial workorder.");
    if (typeof ready.createRemovalWorkorder !== "function") {
      throw new Error("The custody fixture must provide createRemovalWorkorder after the original workorder closes.");
    }
    await ready.createRemovalWorkorder();
    assert.equal((await stockSnapshot(pool, ready)).on_hand, "1.000", "Approved installed stock must be consumed exactly once.");

    const removeBody = { ...scope, usageId: originalUsageId, removalWorkorderId: ready.removalWorkorderId, reason: "Local QA removal after verified service.", ownership: "company", ownershipEvidence: "Fixture inventory is company-owned.", idempotencyKey: key(runId, "remove") };
    const removed = await clients.admin.request("/api/inventory-reuse/remove", { method: "POST", body: removeBody });
    const custodyCase = assertCase(removed, "awaiting_handoff", "removal");
    const duplicate = await clients.admin.request("/api/inventory-reuse/remove", { method: "POST", body: removeBody });
    assert.equal(duplicate.body?.replayed, true, "Duplicate removal must replay without a second custody case.");
    assert.equal(duplicate.body?.case?.id, custodyCase.id, "Duplicate removal returned a different custody case.");
    const changedKey = await clients.admin.request("/api/inventory-reuse/remove", { method: "POST", expectedStatuses: [409], body: { ...removeBody, reason: "Changed request must not replay.", idempotencyKey: removeBody.idempotencyKey } });
    assertCode(changedKey, "INVENTORY_REUSE_REPLAY_CONFLICT", "changed-key replay");
    const duplicateState = await clients.admin.request("/api/inventory-reuse/remove", { method: "POST", expectedStatuses: [409], body: { ...removeBody, idempotencyKey: key(runId, "remove-again") } });
    assertCode(duplicateState, "INVENTORY_REUSE_CHANGED", "new-key duplicate removal");

    const selfApprove = await clients.admin.request(`/api/inventory-reuse/${custodyCase.id}/receive`, { method: "POST", expectedStatuses: [403], body: { ...scope, evidence: "Improper self-handoff.", idempotencyKey: key(runId, "self-receive") } });
    assertCode(selfApprove, "INVENTORY_REUSE_SEPARATION_REQUIRED", "self receive");
    const tenantDenied = await clients.receiver.request(`/api/inventory-reuse?companyId=${randomUUID()}&locationId=${ready.locationId}`, { expectedStatuses: [403] });
    assert.equal(tenantDenied.status, 403, "A non-admin fixture actor unexpectedly bypassed tenant scope.");
    const received = await clients.receiver.request(`/api/inventory-reuse/${custodyCase.id}/receive`, { method: "POST", body: { ...scope, evidence: "Physical handoff received by a separate office actor.", idempotencyKey: key(runId, "receive") } });
    assertCase(received, "received_pending_review", "receive");
    await clients.admin.request("/api/inventory-reuse/config/grant", { method: "POST", body: { ...scope, userId: ready.receiverId, capabilities: [], reason: "Local QA verifies revoked capability." } });
    const revoked = await clients.receiver.request(`/api/inventory-reuse/operations/${encodeURIComponent(key(runId, "receive"))}?companyId=${ready.companyId}&locationId=${ready.locationId}`, { expectedStatuses: [403] });
    assert.equal(revoked.status, 403, "Revoked receiver capability still read an operation confirmation.");

    const released = await clients.releaser.request(`/api/inventory-reuse/${custodyCase.id}/review`, { method: "POST", body: { ...scope, decision: "release", inspectionEvidence: "Inspection passed and serial identity matched.", reason: "Reusable company-owned serialized part released to stock.", idempotencyKey: key(runId, "release") } });
    assertCase(released, "released", "release");
    const releaseReplay = await clients.releaser.request(`/api/inventory-reuse/${custodyCase.id}/review`, { method: "POST", body: { ...scope, decision: "release", inspectionEvidence: "Inspection passed and serial identity matched.", reason: "Reusable company-owned serialized part released to stock.", idempotencyKey: key(runId, "release") } });
    assert.equal(releaseReplay.body?.replayed, true, "Duplicate release must replay without duplicate stock.");
    assert.deepEqual(await stockSnapshot(pool, ready), { on_hand: "2.000", reserved: "0.000", issues: 1, returns: 1, unit_status: "in_stock", receipt_id: ready.receiptId, invoice_run_id: ready.invoiceRunId }, "Released stock snapshot or invoice lineage changed unexpectedly.");

    const reissued = await clients.admin.request(`/api/workorders/${ready.secondWorkorderId}/inventory-units/issue`, { method: "POST", expectedStatuses: [201], body: { unitId: ready.unitId, idempotencyKey: key(runId, "issue-b") } });
    assert.ok(reissued.body?.usage?.id, "Released serialized identity was not reusable on the second truck.");
    await assertReissuedIdentity(pool, ready, reissued.body.usage.id);
    const reinstalled = await clients.admin.request(`/api/workorders/${ready.secondWorkorderId}/inventory-unit-usages/${reissued.body.usage.id}/finalize`, { method: "POST", body: { disposition: "installed", idempotencyKey: key(runId, "install-b") } });
    assert.equal(reinstalled.body?.usage?.status, "installed_pending_approval", "Second-truck installation must await approval.");
    await clients.admin.request(`/api/office/workorders/${ready.secondWorkorderId}/mark-done`, { method: "POST", body: { diagnosis: "Custody QA second-truck installation verified.", workPerformed: "Reinstalled released serialized custody QA part.", confirmationName: "Custody QA Admin" } });
    const reapproved = await clients.admin.request(`/api/office/workorders/${ready.secondWorkorderId}/close`, { method: "POST", body: { note: "Custody QA second-truck office approval." } });
    assert.equal(reapproved.body?.workorder?.status, "closed", "Second-truck office approval did not close the workorder.");
    assert.deepEqual(await stockSnapshot(pool, ready), { on_hand: "1.000", reserved: "0.000", issues: 2, returns: 1, unit_status: "installed", receipt_id: ready.receiptId, invoice_run_id: ready.invoiceRunId }, "Reissue approval must consume the same unit once without duplicating stock or invoice lineage.");
    return { passed: true, runId, caseId: custodyCase.id, originalUsageId, reissueUsageId: reissued.body.usage.id };
  } finally {
    await ready.cleanup();
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  let password = "";
  try {
    const result = await runInventoryCustodyLocal();
    console.log(JSON.stringify({ passed: result.passed, caseId: result.caseId }));
  } catch (error) {
    console.error(redactQaError(error, [password]));
    process.exitCode = 1;
  } finally {
    await closePool().catch(() => {});
  }
}
