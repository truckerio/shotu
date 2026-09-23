import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { closePool, query } from "../pool.js";
import {
  findActiveLocalLaborProduct,
  importOdooLaborProducts,
  listLocalLaborProducts,
  setLocalLaborProductPinned,
} from "./local-labor-products.repo.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === "1";
after(async () => { if (runPostgres) await closePool(); });

test("catalog list is company scoped, location pinned, searchable, and pinned first", async () => {
  let statement;
  let values;
  const items = await listLocalLaborProducts({
    companyId: COMPANY_ID, locationId: LOCATION_ID, q: "  DIAG ",
  }, async (sql, params) => {
    statement = sql;
    values = params;
    return { rows: [{ id: PRODUCT_ID, name: "Diagnostics", code: "DIAG", description: "Diagnose no-start", pinned: true }] };
  });
  assert.match(statement, /product\.company_id = \$1 and product\.active = true/);
  assert.match(statement, /pin\.location_id = \$2/);
  assert.match(statement, /order by coalesce\(pin\.pinned, false\) desc/i);
  assert.deepEqual(values, [COMPANY_ID, LOCATION_ID, "diag", 50]);
  assert.match(statement, /product\.description/);
  assert.deepEqual(items, [{ id: PRODUCT_ID, name: "Diagnostics", code: "DIAG", description: "Diagnose no-start", uomCode: "hr", pinned: true }]);
});

test("trusted lookup requires active company product and active location", async () => {
  let statement;
  const product = await findActiveLocalLaborProduct({
    companyId: COMPANY_ID, locationId: LOCATION_ID, productId: PRODUCT_ID,
  }, async (sql) => {
    statement = sql;
    return { rows: [{ id: PRODUCT_ID, name: "Diagnostics", code: "DIAG", description: "Diagnose no-start", pinned: false }] };
  });
  assert.match(statement, /location\.active = true/);
  assert.match(statement, /product\.company_id = \$1 and product\.id = \$3 and product\.active = true/);
  assert.equal(product.description, "Diagnose no-start");
  assert.equal(product.id, PRODUCT_ID);
});

test("pin mutation derives the tenant from selected active rows", async () => {
  let statement;
  const product = await setLocalLaborProductPinned({
    companyId: COMPANY_ID,
    locationId: LOCATION_ID,
    productId: PRODUCT_ID,
    pinned: true,
    actorId: "actor-1",
  }, async (sql) => {
    statement = sql;
    return { rows: [{ id: PRODUCT_ID, name: "Diagnostics", code: "DIAG", description: "Diagnose no-start", pinned: true }] };
  });
  assert.match(statement, /where product\.company_id = \$1 and product\.id = \$3 and product\.active = true/);
  assert.match(statement, /select company_id, \$2, id, \$4, \$5, now\(\) from selected/);
  assert.match(statement, /selected\.description/);
  assert.equal(product.pinned, true);
  assert.equal(product.description, "Diagnose no-start");
});

test("Odoo labor snapshot copy is tenant-scoped, hourly-only, replay-safe, and rolls back invalid batches", { skip: !runPostgres }, async () => {
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const suffix = randomUUID().replaceAll("-", "");
  const validId = `labor-${suffix}`;
  const freshId = `fresh-${suffix}`;
  const disabledId = `disabled-${suffix}`;
  const eachId = `each-${suffix}`;
  const foreignId = `foreign-${suffix}`;
  const existingId = `existing-${suffix}`;
  const blankId = `zzblank-${suffix}`;
  try {
    await query("insert into companies (id, slug, name) values ($1, $2, $3), ($4, $5, $6)", [
      companyId, `labor-copy-${suffix}`, "Labor copy", otherCompanyId, `labor-copy-other-${suffix}`, "Labor copy other",
    ]);
    const sourceRows = [
      [companyId, validId, "LAB", "Shop labor", true, "Hours", "Working Time", "75.0000", "USD", "140.0000", "USD"],
      [companyId, freshId, "FRESH", "Fresh labor", true, "Hours", "Working Time"],
      [companyId, disabledId, "DIS", "Disabled labor", false, "Hours", "Working Time"],
      [companyId, eachId, "EACH", "Each service", true, "Each", "Unit"],
      [companyId, existingId, "EXIST", "Existing labor", true, "Hours", "Working Time"],
      [companyId, blankId, "BLANK", "", true, "Hours", "Working Time"],
      [otherCompanyId, foreignId, "FOREIGN", "Foreign labor", true, "Hours", "Working Time"],
    ];
    for (const [tenantId, externalId, code, name, active, uomName, category, internalPrice = null, internalCurrency = null, sellingPrice = null, sellingCurrency = null] of sourceRows) {
      await query(`insert into odoo_service_products (
        company_id, external_id, default_code, display_name, uom_external_id, uom_name,
        uom_category_external_id, uom_category_name, active,
        internal_price, internal_currency, selling_price, selling_currency
      ) values ($1, $2, $3, $4, '1', $6, 'time', $7, $5, $8, $9, $10, $11)`, [tenantId, externalId, code, name, active, uomName, category, internalPrice, internalCurrency, sellingPrice, sellingCurrency]);
    }
    await query(`insert into local_labor_products (company_id, name, normalized_name, code, normalized_code)
      values ($1, 'Existing labor', 'existing labor', 'EXIST', 'exist')`, [companyId]);

    const first = await importOdooLaborProducts({ companyId, externalIds: [validId, existingId] });
    assert.deepEqual(first.products.map((product) => [product.externalId, product.created]).sort(), [[existingId, false], [validId, true]]);
    const linked = await query("select source_provider,source_external_id from local_labor_products where company_id=$1 and normalized_name='shop labor'", [companyId]);
    assert.deepEqual(linked.rows[0], { source_provider: "odoo", source_external_id: validId });
    const listed = await listLocalLaborProducts({ companyId, locationId: randomUUID(), q: "shop" });
    assert.equal(listed[0].odooPricing.internal.amount, "75.0000");
    assert.equal(listed[0].odooPricing.selling.amount, "140.0000");
    const replay = await Promise.all([
      importOdooLaborProducts({ companyId, externalIds: [validId, existingId] }),
      importOdooLaborProducts({ companyId, externalIds: [validId, existingId] }),
    ]);
    assert.deepEqual(replay.flatMap((result) => result.products).map((product) => product.created), [false, false, false, false]);
    assert.equal((await query("select count(*)::int as count from local_labor_products where company_id=$1", [companyId])).rows[0].count, 2);
    await query("update odoo_service_products set display_name='Renamed in Odoo',default_code='RENAMED' where company_id=$1 and external_id=$2", [companyId, validId]);
    const renamedReplay = await importOdooLaborProducts({ companyId, externalIds: [validId] });
    assert.equal(renamedReplay.products[0].productId, first.products.find((product) => product.externalId === validId).productId);
    assert.equal((await query("select count(*)::int as count from local_labor_products where company_id=$1", [companyId])).rows[0].count, 2);
    assert.equal((await query("select name from local_labor_products where company_id=$1 and source_external_id=$2", [companyId, validId])).rows[0].name, "Shop labor");

    await assert.rejects(importOdooLaborProducts({ companyId, externalIds: [disabledId] }), /not active hourly services/i);
    await assert.rejects(importOdooLaborProducts({ companyId, externalIds: [eachId] }), /not active hourly services/i);
    await assert.rejects(importOdooLaborProducts({ companyId, externalIds: [foreignId] }), /not active hourly services/i);
    await assert.rejects(importOdooLaborProducts({ companyId, externalIds: [freshId, blankId] }), /missing a name/i);
    assert.equal((await query("select count(*)::int as count from local_labor_products where company_id=$1", [companyId])).rows[0].count, 2);
    assert.equal((await query("select count(*)::int as count from local_labor_products where company_id=$1 and normalized_name='fresh labor'", [companyId])).rows[0].count, 0);
  } finally {
    await query("delete from companies where id = any($1::uuid[])", [[companyId, otherCompanyId]]).catch(() => {});
  }
});
