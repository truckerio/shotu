import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { closePool, getPool, query } from "../../db/pool.js";
import { readLockedWorkorderFinancialSource } from "../../db/repositories/customer-document-workorder-source.repo.js";
import { appendInventorySellingPolicy } from "../../db/repositories/inventory-selling-policies.repo.js";
import { createOperationalWorkorder, updateOfficeUsedParts } from "../../db/repositories/operational-workorders.repo.js";
import { readCreatePricing } from "../../db/repositories/workorder-create-pricing.repo.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

after(async () => { if (enabled) await closePool(); });

test("no-stock Workorder pricing persists billable evidence without physical inventory activity", { skip: !enabled }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyId = randomUUID();
  const locationId = randomUUID();
  const partId = randomUUID();
  let workorderId = null;
  try {
    await query("insert into user_profiles(id,display_name) values($1,'No-stock pricing integration')", [actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'No-stock pricing integration')", [companyId, `no-stock-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'No-stock shop')", [locationId, companyId]);
    await query(
      `insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
       values($1,$2,$3,$4,'Hourly shop service','hr','no_stock')`,
      [partId, companyId, `NOSTOCK${suffix}`, `NO-STOCK-${suffix}`],
    );
    await assert.rejects(
      query(
        `insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,uom_code)
         values($1,$2,$3,$4,$5,'hr')`,
        [companyId, locationId, partId, `NOSTOCK${suffix}`, `NO-STOCK-${suffix}`],
      ),
      (error) => error.constraint === "inventory_no_stock_physical_mutation",
    );
    await assert.rejects(
      query(
        `insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
         values($1,$2,$3,$4,'Invalid physical time item','hr','quantity')`,
        [randomUUID(), companyId, `BADTIME${suffix}`, `BAD-TIME-${suffix}`],
      ),
      (error) => error.constraint === "parts_catalog_time_requires_no_stock",
    );
    const policy = await appendInventorySellingPolicy({
      catalogPartId: partId,
      locationId,
      expectedVersion: 0,
      method: "fixed",
      value: "100.0000",
      currency: "USD",
      reason: "No-stock Workorder integration selling price",
      companyIds: [companyId],
      locationIds: [locationId],
      isAdmin: false,
      actorId,
      idempotencyKey: `no-stock-policy-${suffix}`,
      requestHash: digest(`no-stock-policy-${suffix}`),
    });
    assert.equal(policy.kind, "saved");

    const input = {
      companyId,
      locationId,
      assetId: null,
      createdByUserId: actorId,
      createdByRole: "office",
      concern: "Perform hourly no-stock service",
      officeNotes: "",
      mechanicUserIds: [],
      formData: {
        laborHours: "",
        parts: [{
          catalogPartId: partId,
          partNo: `NO-STOCK-${suffix}`,
          description: "Hourly shop service",
          qty: "1.5",
          uomCode: "hr",
          repairOrder: "Perform service",
          trackingMode: "no_stock",
        }],
      },
      inventoryUnitSelections: [],
      inventoryPositionSelections: [],
      pricing: { parts: [{ partIndex: 0, selection: "selling_price" }] },
    };
    const preview = await readCreatePricing(input);
    assert.equal(preview.parts[0].price.unitPrice, "100.0000");
    assert.equal(preview.parts[0].price.totalPrice, "150.0000");
    assert.equal(preview.parts[0].price.uomCode, "hr");

    const created = await createOperationalWorkorder({
      ...input,
      pricing: { ...input.pricing, expectedFingerprint: preview.fingerprint },
    });
    workorderId = created.id;
    const state = (await query(
      `select workorder.form_data,
              (select count(*)::int from workorder_part_price_snapshots price
                where price.company_id=$1 and price.workorder_id=workorder.id) price_count,
              (select count(*)::int from workorder_serialized_part_usages usage
                where usage.company_id=$1 and usage.workorder_id=workorder.id) serialized_count,
              (select count(*)::int from workorder_aggregate_part_usages usage
                where usage.company_id=$1 and usage.workorder_id=workorder.id) aggregate_count,
              (select count(*)::int from inventory_stock_movements movement
                where movement.company_id=$1 and movement.workorder_id=workorder.id) movement_count
         from operational_workorders workorder where workorder.company_id=$1 and workorder.id=$2`,
      [companyId, workorderId],
    )).rows[0];
    assert.match(state.form_data.parts[0].noStockLineId, /^[0-9a-f-]{36}$/);
    assert.equal(state.form_data.parts[0].trackingMode, "no_stock");
    assert.deepEqual({
      priceCount: state.price_count,
      serializedCount: state.serialized_count,
      aggregateCount: state.aggregate_count,
      movementCount: state.movement_count,
    }, { priceCount: 1, serializedCount: 0, aggregateCount: 0, movementCount: 0 });

    const snapshot = (await query(
      `select * from workorder_part_price_snapshots
        where company_id=$1 and workorder_id=$2`,
      [companyId, workorderId],
    )).rows[0];
    assert.equal(snapshot.no_stock_line_id, state.form_data.parts[0].noStockLineId);
    assert.equal(snapshot.catalog_part_id, partId);
    assert.equal(snapshot.uom_code, "hr");
    assert.equal(snapshot.selection, "selling_price");
    assert.equal(snapshot.total_price, "150.0000");

    const client = await getPool().connect();
    try {
      await client.query("begin");
      const source = await readLockedWorkorderFinancialSource({ companyId, locationId, workorderId }, client);
      assert.equal(source.parts.length, 1);
      assert.equal(source.parts[0].sourceKind, "no_stock_line");
      assert.equal(source.parts[0].quantity, "1.5");
      assert.equal(source.parts[0].totalPrice, "150.0000");
      await client.query("rollback");
    } finally {
      client.release();
    }

    const corrected = await updateOfficeUsedParts(workorderId, actorId, [], undefined);
    assert.deepEqual(corrected.formData.parts, []);
    const retainedPriceCount = (await query(
      `select count(*)::int as count from workorder_part_price_snapshots
       where company_id=$1 and workorder_id=$2`,
      [companyId, workorderId],
    )).rows[0].count;
    assert.equal(retainedPriceCount, 1);
  } finally {
    if (workorderId) {
      await query("delete from workorder_part_price_snapshots where company_id=$1 and workorder_id=$2", [companyId, workorderId]).catch(() => {});
      await query("delete from workorder_authorization_events where company_id=$1 and workorder_id=$2", [companyId, workorderId]).catch(() => {});
      await query("delete from workorder_status_events where workorder_id=$1", [workorderId]).catch(() => {});
      await query("delete from operational_workorders where company_id=$1 and id=$2", [companyId, workorderId]).catch(() => {});
    }
    await query("delete from workorder_serial_counters where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_part_selling_policy_versions where company_id=$1", [companyId]).catch(() => {});
    await query("delete from parts_catalog where company_id=$1", [companyId]).catch(() => {});
    await query("delete from locations where company_id=$1", [companyId]).catch(() => {});
    await query("delete from companies where id=$1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id=$1", [actorId]).catch(() => {});
  }
});
