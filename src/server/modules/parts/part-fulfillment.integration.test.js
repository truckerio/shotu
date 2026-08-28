import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import {
  approvePartFulfillment,
  createPartFulfillment,
  findFulfillmentAvailability,
  findFulfillmentCatalogPart,
} from "../../db/repositories/part-fulfillment.repo.js";
import { closeOperationalWorkorder } from "../../db/repositories/operational-workorders.repo.js";
import { closePool, query } from "../../db/pool.js";
const repo = readFileSync(new URL("../../db/repositories/part-fulfillment.repo.js", import.meta.url), "utf8");
const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === "1";

after(async () => {
  if (runPostgres) await closePool();
});

test("repository locks idempotency identity and bounded availability query", () => {
  assert.match(repo, /idempotency_key = \$3 for update/);
  assert.match(repo, /pg_advisory_xact_lock/);
  assert.match(repo, /source_provider = 'local'/);
  assert.match(repo, /quantity_on_hand > item\.quantity_reserved/);
  assert.match(repo, /limit \$4/);
  assert.match(repo, /begin/);
  assert.match(repo, /commit/);
});

test("real PostgreSQL serializes fulfillment create and approval keys", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyId = randomUUID();
  const destinationId = randomUUID();
  const sourceId = randomUUID();
  const assetId = randomUUID();
  const workorderId = randomUUID();
  const approvalRaceWorkorderId = randomUUID();
  const catalogPartId = randomUUID();
  const localItemId = randomUUID();
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  try {
    await query("insert into user_profiles (id, display_name) values ($1, $2)", [actorId, `Fulfillment ${suffix}`]);
    await query("insert into companies (id, slug, name) values ($1, $2, 'Fulfillment integration')", [companyId, `fulfillment-${suffix}`]);
    await query("insert into locations (id, company_id, name) values ($1, $3, 'Destination'), ($2, $3, 'Source')", [destinationId, sourceId, companyId]);
    await query("insert into assets (id, company_id, location_id, provider, name, unit_no) values ($1,$2,$3,'manual','Fulfillment truck',$4)", [assetId, companyId, destinationId, `F-${suffix.slice(0, 8)}`]);
    await query("insert into operational_workorders (id, company_id, serial, asset_id, location_id, created_by_user_id, concern, status) values ($1,$2,$3,$4,$5,$6,'Fulfillment integration','in_progress')", [workorderId, companyId, `WO-F-${suffix}`, assetId, destinationId, actorId]);
    await query("insert into parts_catalog (id, company_id, normalized_part_number, part_number, description, uom_code) values ($1,$2,$3,$4,'Fulfillment filter','ea')", [catalogPartId, companyId, `FULFILL${suffix}`, `FULFILL-${suffix}`]);
    await query(`insert into inventory_items (id, company_id, location_id, catalog_part_id, normalized_part_number, part_number, description, quantity_on_hand, quantity_reserved, uom_code, source_provider, external_id)
      values ($1,$2,$3,$4,$5,$6,'Local stock',4,0,'ea','local',$7),
             ($8,$2,$9,$4,$5,$6,'Provider projection',99,0,'ea','odoo',$10)`,
    [localItemId, companyId, sourceId, catalogPartId, `FULFILL${suffix}`, `FULFILL-${suffix}`, `local-${suffix}`, randomUUID(), destinationId, `odoo-${suffix}`]);

    const availability = await findFulfillmentAvailability({ companyId, catalogPartId, uomCode: "ea" });
    assert.deepEqual(availability.map((row) => row.id), [localItemId]);
    assert.deepEqual(await findFulfillmentCatalogPart({ companyId, catalogPartId }), { id: catalogPartId, uomCode: "ea" });

    const createCommand = {
      companyId, workorderId, catalogPartId, destinationLocationId: destinationId,
      quantity: 2, uomCode: "ea", neededBy: null, actorId,
      idempotencyKey: `create-${suffix}`, requestHash: digest(`create-${suffix}`),
      legs: [{ routeType: "internal_transfer", sourceLocationId: sourceId, quantity: 2, state: "ready_for_transfer", inventoryItemId: localItemId }],
    };
    const creates = await Promise.all([createPartFulfillment(createCommand), createPartFulfillment(createCommand)]);
    assert.deepEqual(creates.map((result) => result.kind).sort(), ["created", "replay"]);
    const firstId = creates.find((result) => result.fulfillment)?.fulfillment.id;

    const second = await createPartFulfillment({
      ...createCommand,
      idempotencyKey: `create-second-${suffix}`,
      requestHash: digest(`create-second-${suffix}`),
    });
    const approvalKey = `approve-${suffix}`;
    const firstHash = digest(`approve:${firstId}`);
    assert.equal((await approvePartFulfillment({ fulfillmentId: firstId, companyId, actorId, idempotencyKey: approvalKey, requestHash: firstHash, recommendationVersion: 1 })).kind, "approved");
    assert.equal((await approvePartFulfillment({ fulfillmentId: firstId, companyId, actorId, idempotencyKey: approvalKey, requestHash: firstHash, recommendationVersion: 1 })).kind, "replay");
    assert.equal((await approvePartFulfillment({ fulfillmentId: second.fulfillment.id, companyId, actorId, idempotencyKey: approvalKey, requestHash: digest("different"), recommendationVersion: 1 })).kind, "conflict");

    await query("update operational_workorders set status = 'mechanic_done' where id = $1", [workorderId]);
    const createRaceKey = `create-close-race-${suffix}`;
    const createRace = createPartFulfillment({
      ...createCommand,
      idempotencyKey: createRaceKey,
      requestHash: digest(createRaceKey),
    });
    await Promise.all([createRace, closeOperationalWorkorder(workorderId, actorId)]);
    const createRaceState = await query(
      "select state from part_fulfillment_requests where company_id = $1 and created_by_user_id = $2 and idempotency_key = $3",
      [companyId, actorId, createRaceKey],
    );
    assert.ok(!createRaceState.rows[0] || createRaceState.rows[0].state === "cancelled");

    await query("insert into operational_workorders (id, company_id, serial, asset_id, location_id, created_by_user_id, concern, status) values ($1,$2,$3,$4,$5,$6,'Fulfillment approval race','mechanic_done')", [approvalRaceWorkorderId, companyId, `WO-F-AR-${suffix}`, assetId, destinationId, actorId]);
    const approvalRaceRequest = await createPartFulfillment({
      ...createCommand,
      workorderId: approvalRaceWorkorderId,
      idempotencyKey: `approval-race-create-${suffix}`,
      requestHash: digest(`approval-race-create-${suffix}`),
    });
    assert.equal(approvalRaceRequest.kind, "created");
    const approvalRaceKey = `approval-close-race-${suffix}`;
    const [approvalRaceResult] = await Promise.all([
      approvePartFulfillment({
        fulfillmentId: approvalRaceRequest.fulfillment.id,
        companyId,
        actorId,
        idempotencyKey: approvalRaceKey,
        requestHash: digest(approvalRaceKey),
        recommendationVersion: 1,
      }),
      closeOperationalWorkorder(approvalRaceWorkorderId, actorId),
    ]);
    assert.ok(["approved", "inactive"].includes(approvalRaceResult.kind));
    const approvalRaceState = await query("select state from part_fulfillment_requests where id = $1", [approvalRaceRequest.fulfillment.id]);
    assert.equal(approvalRaceState.rows[0].state, "cancelled");
  } finally {
    await query("delete from part_fulfillment_events where company_id = $1", [companyId]).catch(() => {});
    await query("delete from part_fulfillment_legs where company_id = $1", [companyId]).catch(() => {});
    await query("delete from part_fulfillment_requests where company_id = $1", [companyId]).catch(() => {});
    await query("delete from inventory_items where company_id = $1", [companyId]).catch(() => {});
    await query("delete from parts_catalog where company_id = $1", [companyId]).catch(() => {});
    await query("delete from operational_workorders where company_id = $1", [companyId]).catch(() => {});
    await query("delete from assets where company_id = $1", [companyId]).catch(() => {});
    await query("delete from locations where company_id = $1", [companyId]).catch(() => {});
    await query("delete from companies where id = $1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id = $1", [actorId]).catch(() => {});
  }
});
