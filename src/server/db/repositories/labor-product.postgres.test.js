import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { closePool, query } from "../pool.js";
import { getConfiguredLaborProduct, resolveLegacyLocalLaborProduct } from "./labor-product.repo.js";
import { loadWorkorderDetail } from "../../modules/workorders/workorder-detail.service.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
after(async () => { if (enabled) await closePool(); });

test("real PostgreSQL maps configured and saved legacy labor only through an active same-company source link and matching unit", { skip: !enabled }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const actorId = randomUUID();
  const locationId = randomUUID();
  const assetId = randomUUID();
  const workorderId = randomUUID();
  const hourId = randomUUID();
  const eachId = randomUUID();
  const foreignId = randomUUID();
  const hourExternalId = `hour-${suffix}`;
  const eachExternalId = `each-${suffix}`;
  const legacyHour = { externalId: hourExternalId, code: "PTR001", name: "LABOR HOURS", uomCode: "hr" };
  const legacyEach = { externalId: eachExternalId, code: "FLAT", name: "Flat service", uomCode: "ea" };

  try {
    await query("insert into user_profiles(id,display_name) values($1,'Legacy labor integration')", [actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Legacy labor'),($3,$4,'Foreign legacy labor')", [
      companyId, `legacy-labor-${suffix}`, otherCompanyId, `legacy-labor-other-${suffix}`,
    ]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Legacy labor shop')", [locationId, companyId]);
    await query("insert into assets(id,company_id,location_id,provider,name,unit_no) values($1,$2,$3,'manual','Labor truck',$4)", [
      assetId, companyId, locationId, `LEGACY-${suffix.slice(0, 8)}`,
    ]);
    const account = await query(
      "insert into integration_accounts(company_id,provider,status,token_env_key) values($1,'odoo','configured','TEST_ONLY') returning id",
      [companyId],
    );
    for (const [tenantId, externalId, code, name, uomName, category] of [
      [companyId, hourExternalId, "PTR001", "LABOR HOURS", "Hours", "Time"],
      [companyId, eachExternalId, "FLAT", "Flat service", "Each", "Number"],
      [otherCompanyId, hourExternalId, "PTR001", "Foreign labor", "Hours", "Time"],
    ]) {
      await query(`insert into odoo_service_products
        (company_id,external_id,default_code,display_name,uom_external_id,uom_name,uom_category_external_id,uom_category_name)
        values($1,$2,$3,$4,'1',$5,'1',$6)`, [tenantId, externalId, code, name, uomName, category]);
    }
    for (const [id, tenantId, externalId, name, code, uomCode] of [
      [hourId, companyId, hourExternalId, "LABOR HOURS", "PTR001", "hr"],
      [eachId, companyId, eachExternalId, "Flat service", "FLAT", "ea"],
      [foreignId, otherCompanyId, hourExternalId, "Foreign labor", "PTR001", "hr"],
    ]) {
      await query(`insert into local_labor_products
        (id,company_id,name,normalized_name,code,normalized_code,uom_code,source_provider,source_external_id)
        values($1,$2,$4,lower($4),$5,lower($5),$6,'odoo',$3)`, [id, tenantId, externalId, name, code, uomCode]);
    }
    await query(`insert into odoo_service_order_settings
      (company_id,integration_account_id,labor_product_external_id,labor_uom_external_id)
      values($1,$2,$3,'1')`, [companyId, account.rows[0].id, hourExternalId]);
    await query(`insert into operational_workorders
      (id,company_id,serial,asset_id,location_id,created_by_user_id,concern,status,form_data)
      values($1,$2,$3,$4,$5,$6,'Legacy labor identity','in_progress',$7::jsonb)`, [
      workorderId, companyId, `WO-LEGACY-${suffix}`, assetId, locationId, actorId,
      JSON.stringify({ laborProduct: legacyHour, laborHours: "3" }),
    ]);

    assert.equal((await getConfiguredLaborProduct(companyId)).productId, hourId);
    assert.equal((await resolveLegacyLocalLaborProduct({ companyId, legacyProduct: legacyHour })).productId, hourId);
    assert.equal((await loadWorkorderDetail(workorderId)).workorder.formData.laborProduct.productId, hourId);
    assert.equal((await query("select form_data->'laborProduct'->>'productId' as id from operational_workorders where id=$1", [workorderId])).rows[0].id, null,
      "read projection does not rewrite historical form data");

    await query("update odoo_service_order_settings set labor_product_external_id=$2 where company_id=$1", [companyId, eachExternalId]);
    assert.equal((await getConfiguredLaborProduct(companyId)).productId, eachId);
    assert.equal((await resolveLegacyLocalLaborProduct({ companyId, legacyProduct: legacyEach })).productId, eachId);
    assert.equal(await resolveLegacyLocalLaborProduct({ companyId, legacyProduct: { ...legacyHour, uomCode: "ea" } }), null);
    assert.equal(await resolveLegacyLocalLaborProduct({ companyId, legacyProduct: { ...legacyHour, externalId: "missing" } }), null);
    assert.equal(await resolveLegacyLocalLaborProduct({ companyId: otherCompanyId, legacyProduct: legacyEach }), null);

    await query("update local_labor_products set active=false where id=$1", [eachId]);
    assert.equal((await getConfiguredLaborProduct(companyId)).productId, undefined);
    assert.equal(await resolveLegacyLocalLaborProduct({ companyId, legacyProduct: legacyEach }), null);
    await query("update local_labor_products set active=true where id=$1", [eachId]);
    await query("update odoo_service_products set active=false where company_id=$1 and external_id=$2", [companyId, eachExternalId]);
    assert.equal(await getConfiguredLaborProduct(companyId), null);
    assert.equal(await resolveLegacyLocalLaborProduct({ companyId, legacyProduct: legacyEach }), null);
  } finally {
    await query("delete from companies where id = any($1::uuid[])", [[companyId, otherCompanyId]]).catch(() => {});
    await query("delete from user_profiles where id=$1", [actorId]).catch(() => {});
  }
});
