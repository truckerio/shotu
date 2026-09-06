import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createInventoryReuseFixture, reuseDigest } from "../../src/server/modules/inventory/inventory-reuse.fixture.js";
import { mutateInventoryReuse } from "../../src/server/db/repositories/inventory-reuse.repo.js";
import { issueSerializedUnitToWorkorder, finalizeSerializedUnitUsage } from "../../src/server/db/repositories/inventory-unit-workorder-usage.repo.js";
import { getPool, closePool } from "../../src/server/db/pool.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
after(async () => { if (enabled) await closePool(); });

test("custody upgrade preserves installed identity and ledger across seven legacy states", { skip: !enabled }, async () => {
  const target = new URL(process.env.DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(target.hostname));
  assert.match(target.pathname, /^\/inventory_feature_(?:migration_)?qa_/);
  const fixtures = [];
  const expected = [];
  const command = (f, action, actorId, extra) => ({
    companyId: f.companyId, locationId: f.locationId, action, actorId,
    capability: action, idempotencyKey: randomUUID(), requestHash: reuseDigest(randomUUID()), ...extra,
  });
  let client;
  try {
    for (const state of ["installed", "pending", "reserved", "stock", "handoff", "hold", "removed"]) {
      const f = await createInventoryReuseFixture({ installed: ["installed", "handoff", "hold"].includes(state) });
      fixtures.push(f);
      if (["pending", "reserved"].includes(state)) {
        const scope = { companyId: f.companyId, locationId: f.locationId, workorderId: f.workorderId, actorId: f.removerId, actorRole: "office" };
        const issued = await issueSerializedUnitToWorkorder({ ...scope, unitId: f.unitId, idempotencyKey: randomUUID(), requestHash: reuseDigest(randomUUID()) });
        assert.ok(issued.usage, `${state} fixture reservation must succeed`);
        if (state === "pending") await finalizeSerializedUnitUsage({ ...scope, usageId: issued.usage.id, disposition: "installed", idempotencyKey: randomUUID(), requestHash: reuseDigest(randomUUID()) });
      }
      if (["handoff", "hold"].includes(state)) {
        const removed = await mutateInventoryReuse(command(f, "remove", f.removerId, { usageId: f.usageId, removalWorkorderId: f.removalWorkorderId, reason: "Upgrade fixture", ownership: "company", ownershipEvidence: "Fixture purchase" }));
        if (state === "hold") {
          await mutateInventoryReuse(command(f, "receive", f.receiverId, { caseId: removed.case.id, evidence: "Received before upgrade" }));
          await mutateInventoryReuse(command(f, "release", f.releaseId, { caseId: removed.case.id, decision: "hold", reason: "Awaiting review", inspectionEvidence: "Unclassified condition" }));
        }
      }
      if (state === "removed") await getPool().query("update inventory_serialized_units set status='removed',custody_holder_type='unknown',custody_asset_id=null,custody_location_id=null where company_id=$1 and id=$2", [f.companyId, f.unitId]);
      await getPool().query("update inventory_serialized_units set condition_code='unknown' where company_id=$1 and id=$2", [f.companyId, f.unitId]);
      expected.push({ state, fixture: f, holder: ["installed", "pending"].includes(state) ? "asset" : ["stock", "reserved"].includes(state) ? "inventory_location" : state === "handoff" ? "handoff" : "unknown" });
    }
    client = await getPool().connect();
    await client.query("begin");
    const companyIds = fixtures.map((f) => f.companyId);
    const snapshot = async () => {
      const balances = await client.query("select company_id,catalog_part_id,quantity_on_hand,quantity_reserved from inventory_items where company_id=any($1::uuid[]) order by company_id,catalog_part_id", [companyIds]);
      const events = await client.query("select company_id,count(*)::int as n from inventory_unit_events where company_id=any($1::uuid[]) group by company_id order by company_id", [companyIds]);
      const movements = await client.query("select company_id,count(*)::int as n from inventory_stock_movements where company_id=any($1::uuid[]) group by company_id order by company_id", [companyIds]);
      return { balances: balances.rows, events: events.rows, movements: movements.rows };
    };
    const before = await snapshot();
    const migration = await readFile(new URL("../../src/server/db/migrations/120_inventory_custody_backfill_correction.sql", import.meta.url), "utf8");
    await client.query(migration);
    for (const { state, fixture: f, holder } of expected) {
      const { rows: [unit] } = await client.query("select custody_holder_type,custody_asset_id,custody_location_id,custody_legacy_available from inventory_serialized_units where company_id=$1 and id=$2", [f.companyId, f.unitId]);
      assert.equal(unit.custody_holder_type, holder, state);
      assert.equal(unit.custody_asset_id, holder === "asset" ? f.assetId : null, `${state}: linked vehicle`);
      if (holder === "inventory_location") assert.equal(unit.custody_location_id, f.locationId, `${state}: inventory scope`);
      if (!["stock", "reserved"].includes(state)) assert.equal(unit.custody_legacy_available, false, `${state}: cannot grandfather unavailable stock`);
    }
    assert.deepEqual(await snapshot(), before, "backfill must not alter balances or append fabricated history");
    await client.query(migration);
    assert.deepEqual(await snapshot(), before, "repeated backfill must remain ledger-neutral");
  } finally {
    if (client) { await client.query("rollback"); client.release(); }
    for (const f of fixtures.reverse()) await f.cleanup();
  }
});
