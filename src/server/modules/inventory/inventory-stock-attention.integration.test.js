import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closePool, query } from "../../db/pool.js";
import { listLocalInventoryStock } from "../../db/repositories/local-inventory.repo.js";

const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === "1";
after(async () => { if (runPostgres) await closePool(); });

const hash = (value) => createHash("sha256").update(value).digest("hex");
const issues = (row) => [...row.issues].sort();
const locationIssues = (row, locationId) => [...row.locations.find((location) => location.locationId === locationId).issues].sort();

async function fixture() {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const locationIds = [randomUUID(), randomUUID()];
  const otherLocationId = randomUUID();
  await query("insert into user_profiles(id,display_name) values($1,'Stock attention integration')", [actorId]);
  await query("insert into companies(id,slug,name) values($1,$2,'Stock attention'),($3,$4,'Other stock attention')", [companyId, `stock-attention-${suffix}`, otherCompanyId, `other-stock-attention-${suffix}`]);
  await query("insert into locations(id,company_id,name) values($1,$2,'Alpha'),($3,$2,'Beta'),($4,$5,'Other company')", [locationIds[0], companyId, locationIds[1], otherLocationId, otherCompanyId]);
  let commandIndex = 0;
  const addPart = async (label, trackingMode = "quantity", balances = []) => {
    const partId = randomUUID();
    const number = `ATT${label}${suffix}`.toUpperCase();
    await query("insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode) values($1,$2,$3,$3,'Stock attention fixture','ea',$4)", [partId, companyId, number, trackingMode]);
    for (const [locationIndex, quantity] of balances) {
      await query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,
        description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id)
        values($1,$2,$3,$4,$4,'Stock attention fixture',$5,0,'ea','local',$6)`,
      [companyId, locationIds[locationIndex], partId, number, quantity, `attention-${partId}-${locationIndex}`]);
    }
    return { id: partId, number };
  };
  const price = async (partId, amount, locationId = null, version = 1) => {
    commandIndex += 1;
    await query(`insert into inventory_part_price_versions(company_id,location_id,catalog_part_id,price_kind,version,
      amount,currency,tax_treatment,reason,created_by,idempotency_key,request_hash)
      values($1,$2,$3,'internal',$4,$5,$6,'not_configured','Stock attention test',$7,$8,$9)`,
    [companyId, locationId, partId, version, amount, amount === null ? null : "USD", actorId,
      `attention-price-${suffix}-${commandIndex}`, hash(`${suffix}-price-${commandIndex}`)]);
  };
  const policy = async (partId, method = "fixed", value = "10", locationId = null, version = 1) => {
    commandIndex += 1;
    await query(`insert into inventory_part_selling_policy_versions(company_id,location_id,catalog_part_id,version,
      method,value,currency,reason,created_by,idempotency_key,request_hash)
      values($1,$2,$3,$4,$5,$6,$7,'Stock attention test',$8,$9,$10)`,
    [companyId, locationId, partId, version, method, value, method === "markup_percent" ? null : "USD", actorId,
      `attention-policy-${suffix}-${commandIndex}`, hash(`${suffix}-policy-${commandIndex}`)]);
  };
  const read = (options = {}) => listLocalInventoryStock({ companyIds: [companyId], locationIds,
    isAdmin: false, queryText: suffix, limit: 100, ...options });
  const cleanup = async () => {
    await query("delete from odoo_product_mappings where company_id=$1", [companyId]);
    await query("delete from inventory_items where company_id=$1", [companyId]);
    await query("delete from inventory_part_selling_policy_versions where company_id=$1", [companyId]);
    await query("delete from inventory_part_price_versions where company_id=$1", [companyId]);
    await query("delete from parts_catalog where company_id=any($1::uuid[])", [[companyId, otherCompanyId]]);
    await query("delete from locations where id=any($1::uuid[])", [[...locationIds, otherLocationId]]);
    await query("delete from companies where id=any($1::uuid[])", [[companyId, otherCompanyId]]);
    await query("delete from user_profiles where id=$1", [actorId]);
  };
  return { suffix, companyId, otherCompanyId, locationIds, otherLocationId, addPart, price, policy, read, cleanup };
}

test("real PostgreSQL stock attention resolves configured prices per visible location", { skip: !runPostgres }, async () => {
  const f = await fixture();
  try {
    const zero = await f.addPart("ZERO", "quantity", [[0, 2]]);
    await f.price(zero.id, "0");
    await f.policy(zero.id, "fixed", "0");
    const markup = await f.addPart("MARKUP", "quantity", [[0, 2], [1, 3]]);
    await f.price(markup.id, "4");
    await f.policy(markup.id, "markup_percent", "25");
    const cleared = await f.addPart("CLEAR", "quantity", [[0, 1], [1, 1]]);
    await f.price(cleared.id, "4");
    await f.policy(cleared.id, "fixed", "10");
    await f.price(cleared.id, null, f.locationIds[1]);
    const override = await f.addPart("OVERRIDE", "quantity", [[0, 1], [1, 1]]);
    await f.price(override.id, "4");
    await f.policy(override.id, "fixed", "10");
    await f.price(override.id, "0", f.locationIds[1]);
    await f.policy(override.id, "markup_amount", "3", f.locationIds[1]);
    const locationOnly = await f.addPart("LOCATIONONLY", "quantity", [[0, 1], [1, 1]]);
    await f.price(locationOnly.id, "4");
    await f.policy(locationOnly.id, "fixed", "10", f.locationIds[0]);
    const noStock = await f.addPart("NOSTOCK", "no_stock");
    await f.price(noStock.id, "0");
    await f.policy(noStock.id, "fixed", "100");
    const noStockMarkup = await f.addPart("NOSTOCKMARKUP", "no_stock");
    await f.price(noStockMarkup.id, "0");
    await f.policy(noStockMarkup.id, "markup_percent", "10");
    const provider = await f.addPart("PROVIDER", "quantity", [[0, 1]]);
    await query(`insert into odoo_product_mappings(company_id,external_id,catalog_part_id,internal_price,internal_currency,
      selling_price,selling_currency) values($1,$2,$3,5,'USD',20,'USD')`, [f.companyId, `attention-${f.suffix}`, provider.id]);
    const foreignId = randomUUID();
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code)
      values($1,$2,$3,$3,'Other company attention fixture','ea')`,
    [foreignId, f.otherCompanyId, `ATTFOREIGN${f.suffix}`.toUpperCase()]);

    const rows = await f.read();
    const byId = (part) => rows.find((row) => row.catalogPartId === part.id);
    for (const part of [zero, markup, override, noStock]) assert.deepEqual(issues(byId(part)), [], part.number);
    assert.deepEqual(issues(byId(cleared)), ["missing_internal_price"]);
    const exact = await f.read({ catalogPartId: cleared.id, limit: 1 });
    assert.equal(exact.total, 1);
    assert.equal(exact[0].catalogPartId, cleared.id);
    assert.equal((await f.read({ catalogPartId: foreignId })).length, 0, "exact identity cannot cross companies");
    assert.deepEqual(locationIssues(byId(cleared), f.locationIds[0]), []);
    assert.deepEqual(locationIssues(byId(cleared), f.locationIds[1]), ["missing_internal_price"]);
    assert.deepEqual(issues(byId(locationOnly)), ["missing_selling_price"]);
    assert.deepEqual(locationIssues(byId(locationOnly), f.locationIds[0]), []);
    assert.deepEqual(locationIssues(byId(locationOnly), f.locationIds[1]), ["missing_selling_price"]);
    assert.deepEqual(issues(byId(provider)), ["missing_internal_price", "missing_selling_price"]);
    assert.deepEqual(issues(byId(noStockMarkup)), ["missing_selling_price"]);
    assert.equal(rows.length, 8, "the scoped company excludes another company's catalog part");
    assert.deepEqual(issues((await f.read({ locationId: f.locationIds[0] })).find((row) => row.catalogPartId === cleared.id)), []);
    assert.equal((await f.read({ locationIds: [f.otherLocationId] })).length, 0, "another company's location is invisible");
    assert.equal((await listLocalInventoryStock({ companyIds: [f.otherCompanyId], locationIds: f.locationIds, queryText: f.suffix })).length, 0);

    await f.price(cleared.id, "7", f.locationIds[1], 2);
    assert.deepEqual(issues((await f.read()).find((row) => row.catalogPartId === cleared.id)), [], "newer location version is visible on reread");
    await f.price(zero.id, null, null, 2);
    assert.deepEqual(issues((await f.read()).find((row) => row.catalogPartId === zero.id)), ["missing_internal_price"], "newer company clear is visible on reread");
  } finally {
    await f.cleanup();
  }
});

test("real PostgreSQL stock attention orders issues before stock sort, filtering and pagination", { skip: !runPostgres }, async () => {
  const f = await fixture();
  try {
    const healthy = await f.addPart("AHEALTHY", "quantity", [[0, 40], [1, 30]]);
    await f.price(healthy.id, "1"); await f.policy(healthy.id);
    const missingInternal = await f.addPart("BISSUE", "quantity", [[0, 2]]);
    await f.policy(missingInternal.id);
    const missingSelling = await f.addPart("CISSUE", "quantity", [[0, 3]]);
    await f.price(missingSelling.id, "1");

    for (const [sort, expected] of [
      ["available_desc", [missingSelling.id, missingInternal.id, healthy.id]],
      ["locations_desc", [missingSelling.id, missingInternal.id, healthy.id]],
      ["reserved_desc", [missingSelling.id, missingInternal.id, healthy.id]],
      ["low_stock_first", [missingSelling.id, missingInternal.id, healthy.id]],
      ["part_asc", [missingInternal.id, missingSelling.id, healthy.id]],
    ]) {
      const first = await f.read({ sort, availability: "available", limit: 1, offset: 0 });
      const second = await f.read({ sort, availability: "available", limit: 1, offset: 1 });
      const third = await f.read({ sort, availability: "available", limit: 1, offset: 2 });
      assert.deepEqual([first[0].catalogPartId, second[0].catalogPartId, third[0].catalogPartId], expected, sort);
      assert.equal(first.total, 3);
      assert.equal(second.total, 3);
      assert.notDeepEqual(issues(first[0]), []);
      assert.notDeepEqual(issues(second[0]), []);
    }
    const searched = await f.read({ sort: "part_asc", queryText: `ATTBISSUE${f.suffix}`.toUpperCase(), limit: 1 });
    assert.equal(searched.total, 1);
    assert.equal(searched[0].catalogPartId, missingInternal.id);
    const filtered = await f.read({ sort: "available_desc", availability: "out", limit: 1 });
    assert.equal(filtered.total, 0);
    assert.equal(filtered.length, 0);
  } finally {
    await f.cleanup();
  }
});
