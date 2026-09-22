import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closePool, getPool, query } from "../../db/pool.js";
import { mutateInventoryReuse } from "../../db/repositories/inventory-reuse.repo.js";
import { createInventoryReuseFixture } from "./inventory-reuse.fixture.js";

const run = process.env.RUN_POSTGRES_INTEGRATION === "1";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const settle = async (promise, milliseconds = 3_000) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Timed out waiting for module-access lock ordering.")), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
};

after(async () => { if (run) await closePool(); });

test("reuse module access waits on policy scopes before a company-delete cascade takes product rules", { skip: !run }, async () => {
  const fixture = await createInventoryReuseFixture({ installed: false });
  const cleanupCompanyId = randomUUID();
  const scopeId = randomUUID();
  const blocker = await getPool().connect();
  try {
    await query("insert into companies(id,slug,name) values($1,$2,'Module access lock cleanup QA')", [cleanupCompanyId, `module-lock-${randomUUID()}`]);
    await query("insert into workorder_module_policy_scopes(id,scope_type,company_id) values($1,'company',$2)", [scopeId, cleanupCompanyId]);

    await blocker.query("begin");
    await blocker.query("set local lock_timeout = '2s'");
    await blocker.query("lock table workorder_module_policy_scopes in row exclusive mode");

    const receive = mutateInventoryReuse({
      companyId: fixture.companyId,
      locationId: fixture.locationId,
      actorId: fixture.receiverId,
      action: "receive",
      capability: "receive",
      caseId: randomUUID(),
      idempotencyKey: randomUUID(),
      requestHash: digest(randomUUID()),
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const productShare = await query(`select count(*)::int as count
      from pg_locks lock join pg_class relation on relation.oid=lock.relation
      where relation.relname='product_module_access_rules'
        and lock.mode='ShareLock' and lock.granted`);
    assert.equal(productShare.rows[0].count, 0, "module access must not take product-rule ShareLock before policy scopes");

    await blocker.query("delete from companies where id=$1", [cleanupCompanyId]);
    await blocker.query("commit");
    await assert.rejects(settle(receive), { code: "INVENTORY_REUSE_NOT_FOUND" });
  } finally {
    await blocker.query("rollback").catch(() => {});
    blocker.release();
    await query("delete from companies where id=$1", [cleanupCompanyId]).catch(() => {});
    await fixture.cleanup();
  }
});
