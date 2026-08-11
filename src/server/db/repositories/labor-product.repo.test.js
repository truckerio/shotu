import assert from "node:assert/strict";
import test from "node:test";

import { getConfiguredLaborProduct } from "./labor-product.repo.js";

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
