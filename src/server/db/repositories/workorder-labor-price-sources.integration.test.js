import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { closePool, getPool } from "../pool.js";
import { readEffectiveLaborPriceSources } from "./workorder-labor-price-sources.repo.js";
import { createPricingFingerprint, readCreatePricing } from "./workorder-create-pricing.repo.js";
import { saveWorkorderLaborPriceSnapshot } from "./workorder-labor-pricing.repo.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
after(async () => { if (enabled) await closePool(); });

test("Inventory fixed service policy prices labor with immutable provenance and local precedence", { skip: !enabled }, async () => {
  const client = await getPool().connect();
  const companyId = randomUUID(), otherCompanyId = randomUUID(), locationId = randomUUID(), otherLocationId = randomUUID();
  const actorId = randomUUID(), productId = randomUUID(), catalogId = randomUUID();
  const assetId = randomUUID(), workorderId = randomUUID(), suffix = randomUUID();
  const execute = (sql, params) => client.query(sql, params);
  const scope = { companyId, locationId, productId };
  const input = { companyId, locationId, formData: { parts: [], laborProduct: { productId, uomCode: "hr" }, laborHours: "2.5" },
    pricing: { parts: [], labor: { selection: "selling_price" } } };
  const source = async () => (await readEffectiveLaborPriceSources(scope, execute))
    .filter((row) => row.price_kind === "selling_price");
  const internalSource = async () => (await readEffectiveLaborPriceSources(scope, execute))
    .find((row) => row.price_kind === "internal_cost");
  async function policy({ location = null, method = "fixed", value = "100", version = 1 } = {}) {
    const id = randomUUID();
    await client.query(`insert into inventory_part_selling_policy_versions
      (id,company_id,location_id,catalog_part_id,version,method,value,currency,reason,created_by,idempotency_key,request_hash)
      values($1,$2,$3,$4,$5,$6,$7,$8,'Labor fallback fixture',$9,$10,$11)`,
    [id, companyId, location, catalogId, version, method, value, method === "markup_percent" ? null : "USD", actorId, `policy-${id}`, "a".repeat(64)]);
    return id;
  }
  async function configuredCost({ location = null, amount = "35", version = 1 } = {}) {
    const id = randomUUID();
    await client.query(`insert into inventory_part_price_versions
      (id,company_id,location_id,catalog_part_id,price_kind,version,amount,currency,tax_treatment,reason,created_by,idempotency_key,request_hash)
      values($1,$2,$3,$4,'internal',$5,$6,$7,'not_configured','Catalog internal labor fixture',$8,$9,$10)`,
    [id, companyId, location, catalogId, version, amount, amount === null ? null : "USD", actorId, `cost-${id}`, "a".repeat(64)]);
    return id;
  }
  async function localRate({ location = null, amount = "125", version = 1, priceKind = "selling_price" } = {}) {
    const id = randomUUID();
    await client.query(`insert into labor_rate_versions
      (id,company_id,location_id,labor_product_id,price_kind,version,amount,currency,reason,created_by,idempotency_key,request_hash)
      values($1,$2,$3,$4,$11,$5,$6,$7,'Local labor fixture',$8,$9,$10)`,
    [id, companyId, location, productId, version, amount, amount === null ? null : "USD", actorId, `rate-${id}`, "a".repeat(64), priceKind]);
    return id;
  }
  try {
    await client.query("begin");
    await client.query("insert into user_profiles(id,display_name) values($1,'Labor policy test')", [actorId]);
    await client.query("insert into companies(id,slug,name) values($1,$2,'Labor policy test'),($3,$4,'Other labor policy test')",
      [companyId, `labor-policy-${suffix}`, otherCompanyId, `labor-policy-other-${suffix}`]);
    await client.query("insert into locations(id,company_id,name) values($1,$2,'Labor policy shop')", [locationId, companyId]);
    await client.query("insert into locations(id,company_id,name) values($1,$2,'Other labor policy shop')", [otherLocationId, companyId]);
    await client.query(`insert into local_labor_products(id,company_id,name,normalized_name,code,normalized_code,uom_code,created_by_user_id)
      values($1,$2,'Labor policy','labor policy','PTR001','ptr001','hr',$3)`, [productId, companyId, actorId]);
    await client.query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,uom_code,tracking_mode)
      values($1,$2,'PTR001','PTR001','hr','no_stock')`, [catalogId, companyId]);
    await client.query("insert into assets(id,company_id,location_id,provider,name,unit_no) values($1,$2,$3,'manual','Labor policy truck',$4)",
      [assetId, companyId, locationId, suffix]);
    await client.query(`insert into operational_workorders(id,company_id,serial,asset_id,location_id,created_by_user_id,concern,status,form_data)
      values($1,$2,$3,$4,$5,$6,'Labor policy test','in_progress',$7::jsonb)`,
    [workorderId, companyId, `WO-${suffix}`, assetId, locationId, actorId, JSON.stringify(input.formData)]);
    const companyPolicyId = await policy();
    assert.equal((await source())[0].id, companyPolicyId);
    assert.equal((await source())[0].version, "0", "Inventory version is not an existing labor append version");
    assert.deepEqual(await readEffectiveLaborPriceSources({ ...scope, companyId: otherCompanyId }, execute), []);
    const preview = await readCreatePricing(input, client);
    assert.equal(preview.labor.price.rateVersionId, null);
    assert.equal(preview.labor.price.sellingPolicyVersionId, companyPolicyId);
    assert.equal(preview.labor.price.totalPrice, "250.0000");
    assert.equal(preview.labor.currentRates.internal_cost, undefined);
    const companyCostId = await configuredCost();
    const costRate = await internalSource();
    assert.equal(costRate.configured_price_version_id, companyCostId);
    const costInput = { ...input, pricing: { parts: [], labor: { selection: "internal_cost" } } };
    assert.equal((await readCreatePricing(costInput, client)).labor.price.totalPrice, "87.5000");
    const costCommand = { workorderId, actorId, companyIds: [companyId], locationIds: [locationId], isAdmin: false,
      selection: "internal_cost", expectedRateVersionId: companyCostId, reason: "Catalog internal labor cost",
      idempotencyKey: `cost-snapshot-${suffix}`, requestHash: "c".repeat(64) };
    const savedCost = await saveWorkorderLaborPriceSnapshot(costCommand, client);
    assert.equal(savedCost.laborPrice.configuredPriceVersionId, companyCostId);
    assert.equal(savedCost.laborPrice.rateVersionId, null);
    assert.equal(savedCost.laborPrice.sellingPolicyVersionId, null);
    const locationCostId = await configuredCost({ location: locationId, amount: "45" });
    assert.equal((await internalSource()).id, locationCostId);
    assert.equal((await saveWorkorderLaborPriceSnapshot({ ...costCommand, idempotencyKey: `stale-cost-${suffix}` }, client)).kind, "rate_changed");
    assert.equal((await readEffectiveLaborPriceSources({ ...scope, locationId: otherLocationId }, execute))
      .find((row) => row.price_kind === "internal_cost").id, companyCostId);
    await configuredCost({ location: locationId, amount: null, version: 2 });
    assert.equal((await readCreatePricing(costInput, client)).labor.status, "incomplete", "Unknown masks company configured cost");
    const explicitInternal = await localRate({ priceKind: "internal_cost", amount: "55" });
    assert.equal((await internalSource()).id, explicitInternal,
      "explicit local labor rate wins even over catalog Unknown");
    const command = { workorderId, actorId, companyIds: [companyId], locationIds: [locationId], isAdmin: false,
      selection: "selling_price", expectedRateVersionId: companyPolicyId, reason: "Selected service selling policy",
      idempotencyKey: `snapshot-${suffix}`, requestHash: "b".repeat(64) };
    const saved = await saveWorkorderLaborPriceSnapshot(command, client);
    assert.equal(saved.kind, "saved");
    assert.equal(saved.laborPrice.rateVersionId, null);
    assert.equal(saved.laborPrice.sellingPolicyVersionId, companyPolicyId);
    assert.equal(createPricingFingerprint(input, [], { price: saved.laborPrice }), preview.fingerprint);
    assert.equal((await saveWorkorderLaborPriceSnapshot(command, client)).replayed, true);
    await client.query(`insert into odoo_service_products
      (company_id,external_id,default_code,display_name,uom_external_id,uom_name,uom_category_name)
      values($1,'legacy-ptr001','PTR001','Legacy labor','hour','Hours','Time')`, [companyId]);
    await client.query(`update local_labor_products
      set source_provider='odoo',source_external_id='legacy-ptr001'
      where company_id=$1 and id=$2`, [companyId, productId]);
    await client.query(`update operational_workorders
      set form_data=$3::jsonb where company_id=$1 and id=$2`,
    [companyId, workorderId, JSON.stringify({ ...input.formData,
      laborProduct: { externalId: "legacy-ptr001", uomCode: "hr" } })]);
    const legacySaved = await saveWorkorderLaborPriceSnapshot({ ...command,
      idempotencyKey: `legacy-snapshot-${suffix}` }, client);
    assert.equal(legacySaved.kind, "saved", "external-only saved form resolves through its same-company local Odoo link");
    assert.equal(legacySaved.laborPrice.productId, productId);
    await client.query(`update operational_workorders
      set form_data=$3::jsonb where company_id=$1 and id=$2`,
    [companyId, workorderId, JSON.stringify(input.formData)]);
    const overrideInput = { ...input, pricing: { parts: [], labor: { selection: "selling_price", customUnitPrice: "105" } } };
    const overridePreview = await readCreatePricing(overrideInput, client);
    const override = await saveWorkorderLaborPriceSnapshot({ ...command, customUnitPrice: "105", idempotencyKey: `override-${suffix}` }, client);
    assert.equal(override.laborPrice.baseUnitPrice, "100.0000");
    assert.equal(override.laborPrice.totalPrice, "262.5000");
    assert.equal(override.laborPrice.sellingPolicyVersionId, companyPolicyId);
    assert.equal(createPricingFingerprint(overrideInput, [], { price: override.laborPrice }), overridePreview.fingerprint);

    const shopPolicyId = await policy({ location: locationId, value: "110" });
    assert.equal((await source())[0].id, shopPolicyId);
    assert.equal((await readEffectiveLaborPriceSources({ ...scope, locationId: otherLocationId }, execute))
      .find((row) => row.price_kind === "selling_price").id, companyPolicyId,
      "another shop cannot inherit this shop's selling policy");
    assert.equal((await saveWorkorderLaborPriceSnapshot({ ...command, idempotencyKey: `changed-${suffix}` }, client)).kind, "rate_changed");
    assert.equal((await client.query("select selling_policy_version_id,unit_price from workorder_labor_price_snapshots where id=$1", [saved.laborPrice.id])).rows[0].unit_price, "100.0000");
    await policy({ location: locationId, method: "markup_percent", value: "20", version: 2 });
    assert.deepEqual(await source(), [], "current markup cannot fall through to an older fixed policy");
    await policy({ location: locationId, value: "120", version: 3 });
    await client.query("update parts_catalog set uom_code='ea' where id=$1", [catalogId]);
    assert.deepEqual(await source(), [], "unit mismatch cannot supply a labor selling rate");
    await client.query("update parts_catalog set uom_code='hr' where id=$1", [catalogId]);
    await client.query("update local_labor_products set code='' where id=$1", [productId]);
    assert.deepEqual(await source(), [], "blank codes cannot map a service");
    await client.query("update local_labor_products set code='PTR001' where id=$1", [productId]);
    await client.query(`insert into parts_catalog(company_id,normalized_part_number,part_number,uom_code,tracking_mode)
      values($1,'AMBIGUOUSPTR001','ptr001','hr','no_stock')`, [companyId]);
    assert.deepEqual(await source(), [], "ambiguous exact catalog matches remain unavailable");
    const localId = await localRate();
    assert.equal((await source())[0].id, localId, "explicit local rate wins even without a safe catalog mapping");
    assert.equal((await source())[0].selling_policy_version_id, null);
    const unknownId = await localRate({ location: locationId, amount: null });
    assert.equal((await source())[0].id, unknownId);
    assert.equal((await source())[0].amount, null, "explicit Unknown masks company rate and policy fallback");
    assert.equal((await saveWorkorderLaborPriceSnapshot({ ...command, idempotencyKey: `unknown-${suffix}` }, client)).kind, "rate_unavailable");
  } finally {
    await client.query("rollback");
    client.release();
  }
});
