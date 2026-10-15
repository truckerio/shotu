import assert from "node:assert/strict";
import test from "node:test";

import { loadWorkorderDetail } from "./workorder-detail.service.js";

const local = {
  productId: "44444444-4444-4444-8444-444444444444",
  externalId: "", code: "PTR001", name: "LABOR HOURS", uomCode: "hr",
};
const legacy = { externalId: "85226", code: "PTR001", name: "LABOR HOURS", uomCode: "hr" };

function dependencies(formData, resolveLegacyProduct) {
  return {
    loadWorkorder: async () => ({ id: "wo-1", companyId: "company-1", locationId: "loc-1", formData }),
    loadMessages: async () => [],
    loadTimeline: async () => [],
    loadPartRequests: async () => [],
    resolveLegacyProduct,
  };
}

test("detail exposes trusted linked identity for a saved legacy labor selection", async () => {
  const detail = await loadWorkorderDetail("wo-1", dependencies({ laborProduct: legacy, laborHours: "3" }, async (scope) => {
    assert.deepEqual(scope, { companyId: "company-1", legacyProduct: legacy });
    return local;
  }));
  assert.deepEqual(detail.workorder.formData.laborProduct, local);
  assert.equal(detail.workorder.formData.laborHours, "3");
});

test("detail preserves unmatched legacy labor without guessing a local product", async () => {
  const detail = await loadWorkorderDetail("wo-1", dependencies({ laborProduct: legacy }, async () => null));
  assert.deepEqual(detail.workorder.formData.laborProduct, legacy);
});
