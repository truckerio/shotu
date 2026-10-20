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
import {
  appendLaborRateVersion,
  saveWorkorderLaborPriceSnapshot,
} from "../../db/repositories/workorder-labor-pricing.repo.js";
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
  const approvalPartId = randomUUID();
  const configuredPriceId = randomUUID();
  const laborProductId = randomUUID();
  const localItemId = randomUUID();
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  try {
    await query("insert into user_profiles (id, display_name) values ($1, $2)", [actorId, `Fulfillment ${suffix}`]);
    await query("insert into companies (id, slug, name) values ($1, $2, 'Fulfillment integration')", [companyId, `fulfillment-${suffix}`]);
    await query("insert into locations (id, company_id, name) values ($1, $3, 'Destination'), ($2, $3, 'Source')", [destinationId, sourceId, companyId]);
    await query("insert into assets (id, company_id, location_id, provider, name, unit_no) values ($1,$2,$3,'manual','Fulfillment truck',$4)", [assetId, companyId, destinationId, `F-${suffix.slice(0, 8)}`]);
    await query("insert into operational_workorders (id, company_id, serial, asset_id, location_id, created_by_user_id, concern, status) values ($1,$2,$3,$4,$5,$6,'Fulfillment integration','in_progress')", [workorderId, companyId, `WO-F-${suffix}`, assetId, destinationId, actorId]);
    await query(
      `insert into local_labor_products(
         id,company_id,name,normalized_name,code,normalized_code,created_by_user_id,uom_code
       ) values($1,$2,'Fulfillment integration labor','fulfillment integration labor',$3,$4,$5,'hr')`,
      [laborProductId, companyId, `LAB-${suffix}`, `lab-${suffix}`, actorId],
    );
    const laborRate = await appendLaborRateVersion({
      companyId,
      locationId: destinationId,
      productId: laborProductId,
      priceKind: "internal_cost",
      expectedVersion: 0,
      amount: "25.0000",
      currency: "USD",
      reason: "Fulfillment integration labor",
      actorId,
      idempotencyKey: `fulfillment-labor-rate-${suffix}`,
      requestHash: digest(`fulfillment-labor-rate-${suffix}`),
    });
    assert.equal(laborRate.kind, "saved");
    await query(
      `insert into parts_catalog(
         id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode
       ) values($1,$2,$3,$4,'Fulfillment filter','ea','quantity'),
               ($5,$2,$6,$7,'Approval service','ea','no_stock')`,
      [catalogPartId, companyId, `FULFILL${suffix}`, `FULFILL-${suffix}`,
        approvalPartId, `APPROVAL${suffix}`, `APPROVAL-${suffix}`],
    );
    await query(`insert into inventory_items (id, company_id, location_id, catalog_part_id, normalized_part_number, part_number, description, quantity_on_hand, quantity_reserved, uom_code, source_provider, external_id)
      values ($1,$2,$3,$4,$5,$6,'Local stock',4,0,'ea','local',$7),
             ($8,$2,$9,$4,$5,$6,'Provider projection',99,0,'ea','odoo',$10)`,
    [localItemId, companyId, sourceId, catalogPartId, `FULFILL${suffix}`, `FULFILL-${suffix}`, `local-${suffix}`, randomUUID(), destinationId, `odoo-${suffix}`]);
    await query(
      `insert into inventory_part_price_versions(
         id,company_id,location_id,catalog_part_id,price_kind,version,amount,currency,tax_treatment,
         reason,created_by,idempotency_key,request_hash
       ) values($1,$2,$3,$4,'internal',1,0,'USD','out_of_scope','Fulfillment race zero price',$5,$6,$7)`,
      [configuredPriceId, companyId, destinationId, approvalPartId, actorId,
        `fulfillment-price-source-${suffix}`, digest(`fulfillment-price-source-${suffix}`)],
    );
    const prepareApproval = async (targetWorkorderId, lineId, key) => {
      await query(
        `update operational_workorders
            set form_data=jsonb_build_object(
              'laborHours','1',
              'laborProduct',jsonb_build_object('productId',$5::text,'uomCode','hr'),
              'parts',jsonb_build_array(jsonb_build_object(
                'noStockLineId',$2::text,'catalogPartId',$3::text,
                'partNo',$4::text,'qty','1','uomCode','ea'
              ))
            )
          where id=$1`,
        [targetWorkorderId, lineId, approvalPartId, `APPROVAL-${suffix}`, laborProductId],
      );
      await query(
        `insert into workorder_part_price_snapshots(
           company_id,workorder_id,no_stock_line_id,catalog_part_id,uom_code,selection,
           unit_price,quantity,total_price,currency,configured_price_version_id,
           created_by,reason,idempotency_key,request_hash
         ) values($1,$2,$3,$4,'ea','internal_cost',0,1,0,'USD',$5,$6,'Fulfillment race zero price',$7,$8)`,
        [companyId, targetWorkorderId, lineId, approvalPartId, configuredPriceId, actorId,
          key, digest(key)],
      );
      assert.equal((await saveWorkorderLaborPriceSnapshot({
        workorderId: targetWorkorderId,
        actorId,
        companyIds: [companyId],
        locationIds: [destinationId],
        isAdmin: false,
        selection: "internal_cost",
        expectedRateVersionId: laborRate.rate.id,
        reason: "Fulfillment integration labor",
        idempotencyKey: `${key}-labor`,
        requestHash: digest(`${key}-labor`),
      })).kind, "saved");
    };
    await prepareApproval(workorderId, randomUUID(), `fulfillment-workorder-price-${suffix}`);

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
    await Promise.all([
      createRace,
      closeOperationalWorkorder(workorderId, actorId),
    ]);
    const createRaceState = await query(
      "select state from part_fulfillment_requests where company_id = $1 and created_by_user_id = $2 and idempotency_key = $3",
      [companyId, actorId, createRaceKey],
    );
    assert.ok(!createRaceState.rows[0] || createRaceState.rows[0].state === "cancelled");

    await query("insert into operational_workorders (id, company_id, serial, asset_id, location_id, created_by_user_id, concern, status) values ($1,$2,$3,$4,$5,$6,'Fulfillment approval race','mechanic_done')", [approvalRaceWorkorderId, companyId, `WO-F-AR-${suffix}`, assetId, destinationId, actorId]);
    await prepareApproval(
      approvalRaceWorkorderId,
      randomUUID(),
      `fulfillment-approval-race-price-${suffix}`,
    );
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
    await query("delete from workorder_labor_price_snapshots where company_id = $1", [companyId]).catch(() => {});
    await query("delete from labor_rate_versions where company_id = $1", [companyId]).catch(() => {});
    await query("delete from workorder_part_price_snapshots where company_id = $1", [companyId]).catch(() => {});
    await query("delete from inventory_part_price_versions where company_id = $1", [companyId]).catch(() => {});
    await query("delete from part_fulfillment_events where company_id = $1", [companyId]).catch(() => {});
    await query("delete from part_fulfillment_legs where company_id = $1", [companyId]).catch(() => {});
    await query("delete from part_fulfillment_requests where company_id = $1", [companyId]).catch(() => {});
    await query("delete from inventory_items where company_id = $1", [companyId]).catch(() => {});
    await query("delete from parts_catalog where company_id = $1", [companyId]).catch(() => {});
    await query("delete from local_labor_products where company_id = $1", [companyId]).catch(() => {});
    await query("delete from operational_workorders where company_id = $1", [companyId]).catch(() => {});
    await query("delete from assets where company_id = $1", [companyId]).catch(() => {});
    await query("delete from locations where company_id = $1", [companyId]).catch(() => {});
    await query("delete from companies where id = $1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id = $1", [actorId]).catch(() => {});
  }
});
