import assert from "node:assert/strict";
import test from "node:test";

import { getConfiguredLaborProduct, resolveLegacyLocalLaborProduct } from "./labor-product.repo.js";

test("configured labor product is scoped to one company and normalized", async () => {
  let statement;
  let params;
  const result = await getConfiguredLaborProduct("company-1", async (sql, values) => {
    statement = sql;
    params = values;
    return {
      rows: [{ external_id: "91", default_code: "LAB200", display_name: "Shop labor" }],
    };
  });

  assert.match(statement, /settings\.company_id = \$1/);
  assert.match(statement, /settings\.active = true/);
  assert.match(statement, /product\.active = true/);
  assert.deepEqual(params, ["company-1"]);
  assert.deepEqual(result, {
    externalId: "91",
    code: "LAB200",
    name: "Shop labor",
    uomCode: "hr",
  });
});

test("configured labor product returns null when Admin has not selected one", async () => {
  assert.equal(await getConfiguredLaborProduct("company-1", async () => ({ rows: [] })), null);
});

test("configured Odoo default exposes its linked active local labor identity", async () => {
  const productId = "44444444-4444-4444-8444-444444444444";
  const product = await getConfiguredLaborProduct("company-1", async (sql, params) => {
    assert.match(sql, /local\.company_id=product\.company_id/);
    assert.match(sql, /local\.active=true/);
    assert.deepEqual(params, ["company-1"]);
    return { rows: [{
      external_id: "85226", default_code: "PTR001", display_name: "LABOR HOURS", product_type: "service",
      uom_name: "Hours", uom_category_name: "Time", id: productId,
      name: "LABOR HOURS", code: "PTR001", uom_code: "hr",
    }] };
  });
  assert.deepEqual(product, {
    productId, externalId: "", code: "PTR001", name: "LABOR HOURS", uomCode: "hr",
  });
});

test("legacy resolver fails closed for unmatched, ambiguous, inactive, and unit-mismatched links", async () => {
  const input = { companyId: "company-1", legacyProduct: { externalId: "85226", uomCode: "hr" } };
  const row = {
    id: "44444444-4444-4444-8444-444444444444", name: "LABOR HOURS", code: "PTR001",
    uom_code: "hr", uom_name: "Hours", uom_category_name: "Time",
  };
  const resolved = await resolveLegacyLocalLaborProduct(input, async (sql, params) => {
    assert.match(sql, /local\.company_id=\$1/);
    assert.match(sql, /local\.source_external_id=\$2/);
    assert.match(sql, /local\.active=true/);
    assert.match(sql, /source\.active=true/);
    assert.deepEqual(params, ["company-1", "85226", "hr"]);
    return { rows: [row] };
  });
  assert.equal(resolved.productId, row.id);
  assert.equal(await resolveLegacyLocalLaborProduct(input, async () => ({ rows: [] })), null);
  assert.equal(await resolveLegacyLocalLaborProduct(input, async () => ({ rows: [row, row] })), null);
  assert.equal(await resolveLegacyLocalLaborProduct(input, async () => ({ rows: [{ ...row, uom_name: "Each" }] })), null);
  assert.equal(await resolveLegacyLocalLaborProduct({ ...input, legacyProduct: { externalId: "" } }, async () => assert.fail("no query")), null);
});
