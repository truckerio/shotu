import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { closePool, getPool, query } from "../../db/pool.js";
import { readLockedWorkorderFinancialSource } from "../../db/repositories/customer-document-workorder-source.repo.js";
import { appendInventorySellingPolicy } from "../../db/repositories/inventory-selling-policies.repo.js";
import { createOperationalWorkorder, updateOfficeUsedParts } from "../../db/repositories/operational-workorders.repo.js";
import { readCreatePricing } from "../../db/repositories/workorder-create-pricing.repo.js";
import { saveWorkorderPartPriceSnapshot } from "../../db/repositories/workorder-part-pricing.repo.js";

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
    const rejectedMarkup = await appendInventorySellingPolicy({
      catalogPartId: partId, locationId, expectedVersion: 0, method: "markup_percent",
      value: "20.0000", currency: null, reason: "No-stock markup must be rejected",
      companyIds: [companyId], locationIds: [locationId], isAdmin: false, actorId,
      idempotencyKey: `no-stock-markup-${suffix}`, requestHash: digest(`no-stock-markup-${suffix}`),
    });
    assert.equal(rejectedMarkup.kind, "no_stock_fixed_required");
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
    let configuredCostId = randomUUID();
    await query(`insert into inventory_part_price_versions
      (id,company_id,location_id,catalog_part_id,price_kind,version,amount,currency,tax_treatment,reason,created_by,idempotency_key,request_hash)
      values($1,$2,$3,$4,'internal',1,'40.0000','USD','not_configured','No-stock configured internal cost',$5,$6,$7)`,
    [configuredCostId, companyId, locationId, partId, actorId, `no-stock-cost-${suffix}`, digest(`no-stock-cost-${suffix}`)]);

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
      pricing: { parts: [{ partIndex: 0, selection: "internal_cost" }] },
    };
    let preview = await readCreatePricing(input);
    assert.equal(preview.parts[0].price.unitPrice, "40.0000");
    assert.equal(preview.parts[0].price.totalPrice, "60.0000");
    assert.equal(preview.parts[0].price.configuredPriceVersionId, configuredCostId);
    assert.equal(preview.parts[0].options.selling_price.price.totalPrice, "150.0000");
    assert.equal(preview.parts[0].price.uomCode, "hr");

    const nextCostId = randomUUID();
    await query(`insert into inventory_part_price_versions
      (id,company_id,location_id,catalog_part_id,price_kind,version,amount,currency,tax_treatment,previous_version_id,reason,created_by,idempotency_key,request_hash)
      values($1,$2,$3,$4,'internal',2,'40.0000','USD','not_configured',$5,'Updated no-stock cost version',$6,$7,$8)`,
    [nextCostId, companyId, locationId, partId, configuredCostId, actorId,
      `no-stock-cost-v2-${suffix}`, digest(`no-stock-cost-v2-${suffix}`)]);
    await assert.rejects(createOperationalWorkorder({ ...input,
      pricing: { ...input.pricing, expectedFingerprint: preview.fingerprint } }),
    (error) => error.code === "WORKORDER_PRICING_CHANGED");
    assert.equal((await query("select count(*)::int as count from operational_workorders where company_id=$1", [companyId])).rows[0].count, 0,
      "stale source version rolls back the entire Workorder create");
    configuredCostId = nextCostId;
    preview = await readCreatePricing(input);

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
    assert.equal(snapshot.selection, "internal_cost");
    assert.equal(snapshot.configured_price_version_id, configuredCostId);
    assert.equal(snapshot.selling_policy_version_id, null);
    assert.equal(snapshot.receipt_line_id, null);
    assert.equal(snapshot.total_price, "60.0000");

    const client = await getPool().connect();
    try {
      await client.query("begin");
      await assert.rejects(readLockedWorkorderFinancialSource({ companyId, locationId, workorderId }, client),
        (error) => error.code === "CUSTOMER_DOCUMENT_SELLING_PRICE_REQUIRED");
      const selectedSale = await saveWorkorderPartPriceSnapshot({
        workorderId, usageKind: "no_stock", noStockLineId: state.form_data.parts[0].noStockLineId,
        companyIds: [companyId], locationIds: [locationId], isAdmin: false, actorId,
        selection: "selling_price", reason: "Select customer selling price", idempotencyKey: `no-stock-sale-${suffix}`,
        requestHash: digest(`no-stock-sale-${suffix}`),
      }, client);
      assert.equal(selectedSale.kind, "saved");
      assert.equal(selectedSale.snapshot.sellingPolicyVersionId, policy.policy.id);
      const source = await readLockedWorkorderFinancialSource({ companyId, locationId, workorderId }, client);
      assert.equal(source.parts.length, 1);
      assert.equal(source.parts[0].sourceKind, "no_stock_line");
      assert.equal(source.parts[0].quantity, "1.5");
      assert.equal(source.parts[0].totalPrice, "150.0000");
      await client.query("commit");
    } finally {
      client.release();
    }

    await query(`insert into inventory_part_price_versions
      (company_id,location_id,catalog_part_id,price_kind,version,amount,currency,tax_treatment,previous_version_id,reason,created_by,idempotency_key,request_hash)
      values($1,$2,$3,'internal',3,null,null,'not_configured',$4,'Explicit Unknown masks configured cost',$5,$6,$7)`,
    [companyId, locationId, partId, configuredCostId, actorId,
      `no-stock-cost-unknown-${suffix}`, digest(`no-stock-cost-unknown-${suffix}`)]);
    const unknownPreview = await readCreatePricing(input);
    assert.equal(unknownPreview.parts[0].status, "incomplete");
    assert.match(unknownPreview.parts[0].reason, /Unknown/);
    const unknownSelection = await saveWorkorderPartPriceSnapshot({
      workorderId, usageKind: "no_stock", noStockLineId: state.form_data.parts[0].noStockLineId,
      companyIds: [companyId], locationIds: [locationId], isAdmin: false, actorId,
      selection: "internal_cost", reason: "Try masked internal cost",
      idempotencyKey: `no-stock-unknown-${suffix}`, requestHash: digest(`no-stock-unknown-${suffix}`),
    });
    assert.equal(unknownSelection.kind, "configured_price_unavailable");

    const corrected = await updateOfficeUsedParts(workorderId, actorId, [], undefined);
    assert.deepEqual(corrected.formData.parts, []);
    const retainedPriceCount = (await query(
      `select count(*)::int as count from workorder_part_price_snapshots
       where company_id=$1 and workorder_id=$2`,
      [companyId, workorderId],
    )).rows[0].count;
    assert.equal(retainedPriceCount, 2);
  } finally {
    if (workorderId) {
      await query("delete from workorder_part_price_snapshots where company_id=$1 and workorder_id=$2", [companyId, workorderId]).catch(() => {});
      await query("delete from workorder_authorization_events where company_id=$1 and workorder_id=$2", [companyId, workorderId]).catch(() => {});
      await query("delete from workorder_status_events where workorder_id=$1", [workorderId]).catch(() => {});
      await query("delete from operational_workorders where company_id=$1 and id=$2", [companyId, workorderId]).catch(() => {});
    }
    await query("delete from workorder_serial_counters where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_part_selling_policy_versions where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_part_price_versions where company_id=$1", [companyId]).catch(() => {});
    await query("delete from parts_catalog where company_id=$1", [companyId]).catch(() => {});
    await query("delete from locations where company_id=$1", [companyId]).catch(() => {});
    await query("delete from companies where id=$1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id=$1", [actorId]).catch(() => {});
  }
});
