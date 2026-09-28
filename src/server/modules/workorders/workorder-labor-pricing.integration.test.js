import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { closePool, query } from "../../db/pool.js";
import {
  appendLaborRateVersion,
  readWorkorderLaborPricing,
  saveWorkorderLaborPriceSnapshot,
} from "../../db/repositories/workorder-labor-pricing.repo.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
after(async () => { if (enabled) await closePool(); });

test("real PostgreSQL preserves scoped labor rates and immutable Workorder prices", { skip: !enabled }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const locationId = randomUUID();
  const otherLocationId = randomUUID();
  const outsideLocationId = randomUUID();
  const productId = randomUUID();
  const assetId = randomUUID();
  const workorderId = randomUUID();

  const rate = (overrides = {}) => ({
    companyId, locationId: null, productId, priceKind: "selling_price",
    expectedVersion: 0, amount: "19.9500", currency: "USD",
    reason: "Local shop labor rate", actorId,
    idempotencyKey: `rate-${randomUUID()}`, requestHash: hash(overrides),
    ...overrides,
  });
  const selection = (overrides = {}) => ({
    workorderId, actorId, companyIds: [companyId], locationIds: [locationId], isAdmin: false,
    selection: "selling_price", expectedRateVersionId: null,
    reason: "Local labor price", idempotencyKey: `price-${randomUUID()}`,
    requestHash: hash(overrides), ...overrides,
  });

  try {
    await query("insert into user_profiles(id,display_name) values($1,'Labor pricing integration')", [actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Labor pricing integration'),($3,$4,'Other labor company')",
      [companyId, `labor-${suffix}`, otherCompanyId, `labor-other-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Main labor shop'),($3,$2,'Second labor shop'),($4,$5,'Outside labor shop')",
      [locationId, companyId, otherLocationId, outsideLocationId, otherCompanyId]);
    await query("insert into assets(id,company_id,location_id,provider,name,unit_no) values($1,$2,$3,'manual','Labor demo truck',$4)",
      [assetId, companyId, locationId, `LABOR-${suffix.slice(0, 8)}`]);
    await query(`insert into local_labor_products(id,company_id,name,normalized_name,code,normalized_code,created_by_user_id)
      values($1,$2,$3,$4,$5,$6,$7)`, [productId, companyId, `Labor ${suffix}`, `labor ${suffix}`, `L-${suffix}`, `l-${suffix}`, actorId]);
    await query(`insert into operational_workorders
      (id,company_id,serial,asset_id,location_id,created_by_user_id,concern,status,form_data)
      values($1,$2,$3,$4,$5,$6,'Labor pricing test','in_progress',$7::jsonb)`,
    [workorderId, companyId, `WO-LABOR-${suffix}`, assetId, locationId, actorId,
      JSON.stringify({ laborProduct: { productId }, laborHours: "2.35" })]);

    const companyRateCommand = rate({ idempotencyKey: `company-selling-${suffix}`, requestHash: hash("company selling") });
    const companyRate = await appendLaborRateVersion(companyRateCommand);
    assert.equal(companyRate.kind, "saved");
    assert.equal(companyRate.rate.version, 1);
    assert.equal(companyRate.rate.locationId, null);
    assert.equal((await appendLaborRateVersion(companyRateCommand)).replayed, true);
    assert.equal((await appendLaborRateVersion({ ...companyRateCommand, requestHash: hash("changed") })).kind, "idempotency_conflict");
    assert.equal((await appendLaborRateVersion(rate({
      expectedVersion: 0, amount: "20.0000", idempotencyKey: `stale-${suffix}`,
    }))).kind, "version_conflict");

    const inherited = await readWorkorderLaborPricing({ companyId, locationId, workorderId, productId });
    assert.equal(inherited.currentLaborRates.selling_price.id, companyRate.rate.id);
    const first = await saveWorkorderLaborPriceSnapshot(selection({
      expectedRateVersionId: companyRate.rate.id,
      idempotencyKey: `company-price-${suffix}`, requestHash: hash("company price"),
    }));
    assert.equal(first.kind, "saved");
    assert.equal(first.laborPrice.hours, "2.35");
    assert.equal(first.laborPrice.totalPrice, "46.8825");

    const overrideRate = await appendLaborRateVersion(rate({
      locationId, amount: "21.0050", idempotencyKey: `shop-selling-${suffix}`,
    }));
    assert.equal(overrideRate.kind, "saved");
    const effective = await readWorkorderLaborPricing({ companyId, locationId, workorderId, productId });
    assert.equal(effective.currentLaborRates.selling_price.id, overrideRate.rate.id);
    assert.equal(effective.laborPrice.id, first.laborPrice.id, "later rates cannot rewrite an existing price");
    assert.equal(effective.laborPrice.totalPrice, "46.8825");
    const otherShop = await readWorkorderLaborPricing({ companyId, locationId: otherLocationId, workorderId, productId });
    assert.equal(otherShop.currentLaborRates.selling_price.id, companyRate.rate.id);
    const changedRate = await saveWorkorderLaborPriceSnapshot(selection({
      expectedRateVersionId: companyRate.rate.id,
    }));
    assert.equal(changedRate.kind, "rate_changed");
    assert.equal(changedRate.current.id, overrideRate.rate.id);

    const shopSelection = selection({
      expectedRateVersionId: overrideRate.rate.id,
      idempotencyKey: `shop-price-${suffix}`, requestHash: hash("shop price"),
    });
    const second = await saveWorkorderLaborPriceSnapshot(shopSelection);
    assert.equal(second.kind, "saved");
    assert.equal(second.laborPrice.unitPrice, "21.0050");
    assert.equal(second.laborPrice.totalPrice, "49.3618", "hourly rate times hours rounds to four decimals");
    assert.equal((await saveWorkorderLaborPriceSnapshot(shopSelection)).laborPrice.id, second.laborPrice.id);
    assert.equal((await saveWorkorderLaborPriceSnapshot({ ...shopSelection, requestHash: hash("changed") })).kind, "idempotency_conflict");
    assert.equal((await query("select count(*)::int as count from workorder_labor_price_snapshots where company_id=$1 and workorder_id=$2",
      [companyId, workorderId])).rows[0].count, 2);

    const internalCompany = await appendLaborRateVersion(rate({
      priceKind: "internal_cost", amount: "10.0000", idempotencyKey: `company-internal-${suffix}`,
    }));
    assert.equal(internalCompany.kind, "saved");
    const unknown = await appendLaborRateVersion(rate({
      locationId, priceKind: "internal_cost", amount: null, currency: null,
      idempotencyKey: `shop-unknown-${suffix}`,
    }));
    assert.equal(unknown.rate.status, "unknown");
    const masked = await readWorkorderLaborPricing({ companyId, locationId, workorderId, productId });
    assert.equal(masked.currentLaborRates.internal_cost.id, unknown.rate.id);
    assert.equal(masked.currentLaborRates.internal_cost.amount, null);
    assert.equal((await saveWorkorderLaborPriceSnapshot(selection({ selection: "internal_cost" }))).kind, "rate_unavailable");
    assert.equal((await readWorkorderLaborPricing({ companyId, locationId: otherLocationId, workorderId, productId }))
      .currentLaborRates.internal_cost.id, internalCompany.rate.id);

    assert.equal((await appendLaborRateVersion(rate({
      locationId: outsideLocationId, idempotencyKey: `outside-rate-${suffix}`,
    }))).kind, "not_found", "a company cannot add a rate to another company's shop");
    assert.equal((await saveWorkorderLaborPriceSnapshot(selection({
      companyIds: [otherCompanyId], locationIds: [outsideLocationId],
    }))).kind, "not_found", "a different company cannot price this Workorder");
    assert.equal((await saveWorkorderLaborPriceSnapshot(selection({
      locationIds: [otherLocationId],
    }))).kind, "not_found", "a different shop cannot price this Workorder");

    await query("update operational_workorders set status='closed' where id=$1", [workorderId]);
    assert.equal((await saveWorkorderLaborPriceSnapshot(selection())).kind, "locked");
    const immutable = await readWorkorderLaborPricing({ companyId, locationId, workorderId, productId });
    assert.equal(immutable.laborPrice.id, second.laborPrice.id);
    assert.equal(immutable.laborPrice.totalPrice, "49.3618");
  } finally {
    await query("delete from workorder_labor_price_snapshots where company_id=$1", [companyId]).catch(() => {});
    await query("delete from labor_rate_versions where company_id=$1", [companyId]).catch(() => {});
    await query("delete from operational_workorders where company_id=$1", [companyId]).catch(() => {});
    await query("delete from local_labor_products where company_id=$1", [companyId]).catch(() => {});
    await query("delete from assets where company_id=$1", [companyId]).catch(() => {});
    await query("delete from locations where company_id=any($1::uuid[])", [[companyId, otherCompanyId]]).catch(() => {});
    await query("delete from companies where id=any($1::uuid[])", [[companyId, otherCompanyId]]).catch(() => {});
    await query("delete from user_profiles where id=$1", [actorId]).catch(() => {});
  }
});
