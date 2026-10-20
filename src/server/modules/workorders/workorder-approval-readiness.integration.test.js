import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { closeOperationalWorkorder } from "../../db/repositories/operational-workorders.repo.js";
import {
  appendLaborRateVersion,
  saveWorkorderLaborPriceSnapshot,
} from "../../db/repositories/workorder-labor-pricing.repo.js";
import { closePool, query } from "../../db/pool.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
if (enabled) {
  const database = new URL(process.env.DATABASE_URL);
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)
      && /^\/approval_readiness_test_[a-f0-9]{32}$/.test(database.pathname),
    "Approval-readiness integration requires its disposable local database runner.",
  );
}
after(async () => { if (enabled) await closePool(); });

const digest = (value) => createHash("sha256").update(String(value)).digest("hex");

test("real PostgreSQL rejects incomplete approval before stock or queue writes, then accepts priced labor with a full discount", { skip: !enabled }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyId = randomUUID();
  const locationId = randomUUID();
  const assetId = randomUUID();
  const workorderId = randomUUID();
  const productId = randomUUID();
  const partId = randomUUID();
  const usageId = randomUUID();
  const noStockPartId = randomUUID();
  const noStockLineId = randomUUID();
  try {
    await query("insert into user_profiles(id,display_name) values($1,'Approval readiness')", [actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Approval readiness')", [companyId, `approval-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Approval shop')", [locationId, companyId]);
    await query(
      "insert into assets(id,company_id,location_id,provider,name,unit_no) values($1,$2,$3,'manual','Approval truck',$4)",
      [assetId, companyId, locationId, `APP-${suffix.slice(0, 8)}`],
    );
    await query(
      `insert into local_labor_products(
         id,company_id,name,normalized_name,code,normalized_code,created_by_user_id,uom_code
       ) values($1,$2,'Approval labor','approval labor',$3,$4,$5,'hr')`,
      [productId, companyId, `LAB-${suffix}`, `lab-${suffix}`, actorId],
    );
    await query(
      `insert into parts_catalog(
         id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode
       ) values($1,$2,$3,$4,'Approval part','ea','quantity'),
               ($5,$2,$6,$7,'Approval no-stock service','ea','no_stock')`,
      [partId, companyId, `PART${suffix}`, `PART-${suffix}`,
        noStockPartId, `SERVICE${suffix}`, `SERVICE-${suffix}`],
    );
    await query(
      `insert into operational_workorders(
         id,company_id,serial,asset_id,location_id,created_by_user_id,concern,status,form_data
       ) values($1,$2,$3,$4,$5,$6,'Approval readiness','in_progress',$7::jsonb)`,
      [workorderId, companyId, `WO-APP-${suffix}`, assetId, locationId, actorId,
        JSON.stringify({ laborHours: "2", laborProduct: { productId, uomCode: "hr" }, parts: [] })],
    );
    await query(
      `insert into inventory_items(
         company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,
         quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id
       ) values($1,$2,$3,$4,$5,'Approval part',5,1,'ea','local',$6)`,
      [companyId, locationId, partId, `PART${suffix}`, `PART-${suffix}`, `approval:${suffix}`],
    );
    await query(
      `insert into workorder_aggregate_part_usages(
         id,company_id,workorder_id,location_id,catalog_part_id,quantity,uom_code,tracking_mode,status,
         repair_order,created_by_user_id,finalized_by_user_id,idempotency_key,request_hash,pending_at
       ) values($1,$2,$3,$4,$5,1,'ea','quantity','installed_pending_approval','Install approval part',$6,$6,$7,$8,now())`,
      [usageId, companyId, workorderId, locationId, partId, actorId,
        `usage-${suffix}`, digest(`usage-${suffix}`)],
    );

    const rate = await appendLaborRateVersion({
      companyId,
      locationId,
      productId,
      priceKind: "internal_cost",
      expectedVersion: 0,
      amount: "25.0000",
      currency: "USD",
      reason: "Approval integration labor",
      actorId,
      idempotencyKey: `labor-rate-${suffix}`,
      requestHash: digest(`labor-rate-${suffix}`),
    });
    assert.equal(rate.kind, "saved");
    await query("update operational_workorders set status='mechanic_done',mechanic_done_at=now() where id=$1", [workorderId]);
    await assert.rejects(
      closeOperationalWorkorder(workorderId, actorId, "Attempt without a labor price."),
      (error) => error.code === "WORKORDER_APPROVAL_LABOR_PRICE_REQUIRED",
    );
    for (const laborHours of ["", "0", "invalid"]) {
      await query(
        `update operational_workorders
            set form_data=form_data || $2::jsonb,updated_at=now()
          where id=$1`,
        [workorderId, JSON.stringify({
          laborHours,
          customerDocumentAdjustments: { discountKind: "percentage", discountValue: "100", reason: "Test discount" },
        })],
      );
      await assert.rejects(
        closeOperationalWorkorder(workorderId, actorId, `Attempt ${laborHours || "blank"} labor with full discount.`),
        (error) => error.code === "WORKORDER_APPROVAL_LABOR_INVALID",
      );
    }
    assert.equal((await query("select count(*)::int count from odoo_entry_status where workorder_id=$1", [workorderId])).rows[0].count, 0);
    await query(
      `update operational_workorders
          set form_data=jsonb_set(form_data,'{laborHours}','\"2\"'::jsonb),updated_at=now()
        where id=$1`,
      [workorderId],
    );
    const labor = await saveWorkorderLaborPriceSnapshot({
      workorderId,
      actorId,
      companyIds: [companyId],
      locationIds: [locationId],
      isAdmin: false,
      selection: "internal_cost",
      expectedRateVersionId: rate.rate.id,
      reason: "Approval integration labor",
      idempotencyKey: `labor-price-${suffix}`,
      requestHash: digest(`labor-price-${suffix}`),
    });
    assert.equal(labor.kind, "saved");
    await query(
      `update operational_workorders
          set form_data=jsonb_set(form_data,'{laborHours}','\"3\"'::jsonb),updated_at=now()
        where id=$1`,
      [workorderId],
    );
    await assert.rejects(
      closeOperationalWorkorder(workorderId, actorId, "Attempt with stale labor quantity."),
      (error) => error.code === "WORKORDER_APPROVAL_LABOR_PRICE_REQUIRED",
    );
    await query(
      `update operational_workorders
          set form_data=jsonb_set(form_data,'{laborHours}','\"2\"'::jsonb),updated_at=now()
        where id=$1`,
      [workorderId],
    );

    await assert.rejects(
      closeOperationalWorkorder(workorderId, actorId, "Attempt without a part price."),
      (error) => error.code === "WORKORDER_APPROVAL_PART_PRICE_REQUIRED",
    );
    assert.deepEqual((await query(
      "select quantity_on_hand,quantity_reserved from inventory_items where company_id=$1 and catalog_part_id=$2",
      [companyId, partId],
    )).rows[0], { quantity_on_hand: "5.000", quantity_reserved: "1.000" });
    assert.equal((await query("select status from workorder_aggregate_part_usages where id=$1", [usageId])).rows[0].status, "installed_pending_approval");
    assert.equal((await query("select count(*)::int count from odoo_entry_status where workorder_id=$1", [workorderId])).rows[0].count, 0);

    const configuredPriceId = randomUUID();
    await query(
      `insert into inventory_part_price_versions(
         id,company_id,location_id,catalog_part_id,price_kind,version,amount,currency,tax_treatment,
         reason,created_by,idempotency_key,request_hash
       ) values($1,$2,$3,$4,'internal',1,0,'USD','out_of_scope','Explicit selected zero',$5,$6,$7)`,
      [configuredPriceId, companyId, locationId, partId, actorId,
        `part-rate-${suffix}`, digest(`part-rate-${suffix}`)],
    );
    await query(
      `insert into workorder_part_price_snapshots(
         company_id,workorder_id,aggregate_usage_id,selection,unit_price,quantity,total_price,currency,
         configured_price_version_id,created_by,reason,idempotency_key,request_hash
       ) values($1,$2,$3,'internal_cost',0,2,0,'USD',$4,$5,'Stale quantity price',$6,$7)`,
      [companyId, workorderId, usageId, configuredPriceId, actorId,
        `stale-price-${suffix}`, digest(`stale-price-${suffix}`)],
    );
    await assert.rejects(
      closeOperationalWorkorder(workorderId, actorId, "Attempt with stale quantity."),
      (error) => error.code === "WORKORDER_APPROVAL_PART_PRICE_REQUIRED",
    );
    assert.equal((await query("select count(*)::int count from odoo_entry_status where workorder_id=$1", [workorderId])).rows[0].count, 0);

    await query(
      `update workorder_aggregate_part_usages
          set status='released',released_at=now(),updated_at=now()
        where id=$1`,
      [usageId],
    );
    await query("update inventory_items set quantity_reserved=0 where company_id=$1 and catalog_part_id=$2", [companyId, partId]);
    await query(
      `update operational_workorders
          set form_data=jsonb_set(form_data,'{parts}',$2::jsonb),updated_at=now()
        where id=$1`,
      [workorderId, JSON.stringify([{ noStockLineId, catalogPartId: noStockPartId,
        partNo: `SERVICE-${suffix}`, qty: "1", uomCode: "ea" }])],
    );
    const noStockConfiguredPriceId = randomUUID();
    await query(
      `insert into inventory_part_price_versions(
         id,company_id,location_id,catalog_part_id,price_kind,version,amount,currency,tax_treatment,
         reason,created_by,idempotency_key,request_hash
       ) values($1,$2,$3,$4,'internal',1,0,'USD','out_of_scope','Explicit selected zero',$5,$6,$7)`,
      [noStockConfiguredPriceId, companyId, locationId, noStockPartId, actorId,
        `no-stock-rate-${suffix}`, digest(`no-stock-rate-${suffix}`)],
    );
    await query(
      `insert into workorder_part_price_snapshots(
         company_id,workorder_id,no_stock_line_id,catalog_part_id,uom_code,selection,
         unit_price,quantity,total_price,currency,configured_price_version_id,
         created_by,reason,idempotency_key,request_hash
       ) values($1,$2,$3,$4,'ea','internal_cost',0,1,0,'USD',$5,$6,'Explicit selected zero',$7,$8)`,
      [companyId, workorderId, noStockLineId, noStockPartId, noStockConfiguredPriceId, actorId,
        `exact-price-${suffix}`, digest(`exact-price-${suffix}`)],
    );
    await closeOperationalWorkorder(workorderId, actorId, "Approved priced labor and exact zero part with full discount.");
    assert.deepEqual((await query(
      "select quantity_on_hand,quantity_reserved from inventory_items where company_id=$1 and catalog_part_id=$2",
      [companyId, partId],
    )).rows[0], { quantity_on_hand: "5.000", quantity_reserved: "0.000" });
    assert.equal((await query("select status from workorder_aggregate_part_usages where id=$1", [usageId])).rows[0].status, "released");
    assert.equal((await query("select count(*)::int count from odoo_entry_status where workorder_id=$1", [workorderId])).rows[0].count, 1);
    assert.equal((await query("select status from operational_workorders where id=$1", [workorderId])).rows[0].status, "closed");

  } finally {
    // The dedicated runner drops the whole random database. This cleanup keeps a failed
    // assertion readable during an interactive rerun without touching any shared data.
    await query("delete from inventory_stock_movements where company_id=$1", [companyId]).catch(() => {});
    await query("delete from workorder_aggregate_part_usage_events where company_id=$1", [companyId]).catch(() => {});
    await query("delete from workorder_part_price_snapshots where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_part_price_versions where company_id=$1", [companyId]).catch(() => {});
    await query("delete from workorder_labor_price_snapshots where company_id=$1", [companyId]).catch(() => {});
    await query("delete from labor_rate_versions where company_id=$1", [companyId]).catch(() => {});
    await query("delete from workorder_aggregate_part_usages where company_id=$1", [companyId]).catch(() => {});
    await query("delete from odoo_entry_status where workorder_id in (select id from operational_workorders where company_id=$1)", [companyId]).catch(() => {});
    await query("delete from workorder_status_events where workorder_id in (select id from operational_workorders where company_id=$1)", [companyId]).catch(() => {});
    await query("delete from operational_workorders where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_items where company_id=$1", [companyId]).catch(() => {});
    await query("delete from local_labor_products where company_id=$1", [companyId]).catch(() => {});
    await query("delete from parts_catalog where company_id=$1", [companyId]).catch(() => {});
    await query("delete from assets where company_id=$1", [companyId]).catch(() => {});
    await query("delete from locations where company_id=$1", [companyId]).catch(() => {});
    await query("delete from companies where id=$1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id=$1", [actorId]).catch(() => {});
  }
});
