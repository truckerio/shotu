import assert from "node:assert/strict";
import test from "node:test";

import {
  findActiveLocalLaborProduct,
  listLocalLaborProducts,
  setLocalLaborProductPinned,
} from "./local-labor-products.repo.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";

test("catalog list is company scoped, location pinned, searchable, and pinned first", async () => {
  let statement;
  let values;
  const items = await listLocalLaborProducts({
    companyId: COMPANY_ID, locationId: LOCATION_ID, q: "  DIAG ",
  }, async (sql, params) => {
    statement = sql;
    values = params;
    return { rows: [{ id: PRODUCT_ID, name: "Diagnostics", code: "DIAG", pinned: true }] };
  });
  assert.match(statement, /product\.company_id = \$1 and product\.active = true/);
  assert.match(statement, /pin\.location_id = \$2/);
  assert.match(statement, /order by coalesce\(pin\.pinned, false\) desc/i);
  assert.deepEqual(values, [COMPANY_ID, LOCATION_ID, "diag", 50]);
  assert.deepEqual(items, [{ id: PRODUCT_ID, name: "Diagnostics", code: "DIAG", uomCode: "hr", pinned: true }]);
});

test("trusted lookup requires active company product and active location", async () => {
  let statement;
  const product = await findActiveLocalLaborProduct({
    companyId: COMPANY_ID, locationId: LOCATION_ID, productId: PRODUCT_ID,
  }, async (sql) => {
    statement = sql;
    return { rows: [{ id: PRODUCT_ID, name: "Diagnostics", code: "DIAG", pinned: false }] };
  });
  assert.match(statement, /location\.active = true/);
  assert.match(statement, /product\.company_id = \$1 and product\.id = \$3 and product\.active = true/);
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
    return { rows: [{ id: PRODUCT_ID, name: "Diagnostics", code: "DIAG", pinned: true }] };
  });
  assert.match(statement, /where product\.company_id = \$1 and product\.id = \$3 and product\.active = true/);
  assert.match(statement, /select company_id, \$2, id, \$4, \$5, now\(\) from selected/);
  assert.equal(product.pinned, true);
});
