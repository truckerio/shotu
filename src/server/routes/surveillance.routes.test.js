import assert from "node:assert/strict";
import test from "node:test";

import { handleSurveillanceApi } from "./surveillance.routes.js";

const WORKORDER_ID = "11111111-1111-4111-8111-111111111111";

function harness(method, suffix) {
  return {
    req: { method, requestId: "request-one" },
    res: {},
    url: new URL(`/api/surveillance/workorders/${WORKORDER_ID}/${suffix}`, "http://localhost"),
    helpers: {
      requestContext: { actor: { id: "surveillance-one", role: "surveillance" } },
      sendJson: () => assert.fail("Removed routes must not send a response."),
    },
  };
}

test("Surveillance Odoo compatibility aliases are removed", async () => {
  for (const [method, suffix] of [
    ["GET", "odoo-readiness"],
    ["PUT", "odoo-preparation"],
    ["POST", "odoo-draft"],
    ["POST", "mark-missing-info"],
    ["POST", "mark-odoo-entered"],
  ]) {
    const target = harness(method, suffix);
    assert.equal(await handleSurveillanceApi(
      target.req,
      target.res,
      target.url,
      target.helpers,
    ), false);
  }
});

test("Surveillance detail loads persisted pricing through protected projection", async () => {
  const context = { actor: { id: "viewer", role: "surveillance" }, companyIds: new Set(["company-1"]), companyRoles: new Map([["company-1", "surveillance"]]) };
  let response;
  let pricingReads = 0;
  await handleSurveillanceApi({ method: "GET" }, {}, new URL(`/api/surveillance/workorders/${WORKORDER_ID}`, "http://localhost"), {
    requestContext: context,
    sendJson: (_res, status, body) => { assert.equal(status, 200); response = body; },
  }, {
    resolveModules: async () => ({ workorder: { companyId: "company-1" }, decisions: { parts: { access: "read" }, diagnosisRepair: { access: "read" } } }),
    loadDetail: async () => ({ workorder: { id: WORKORDER_ID, companyId: "company-1", locationId: "shop-1", formData: { parts: [], laborHours: 2, laborProduct: { productId: "labor-1", uomCode: "hr" } } } }),
    listInstalledParts: async () => [{ usageId: "serial-1", quantity: 1, price: { selection: "selling_price", unitPrice: "75", totalPrice: "75", currency: "USD" } }],
    listAggregateUsages: async () => [],
    readLaborPricing: async () => { pricingReads++; return { laborPrice: { productId: "labor-1", hours: 2, uomCode: "hr", selection: "selling_price", unitPrice: "100", totalPrice: "200", currency: "USD" }, currentLaborRates: {} }; },
  });
  assert.equal(pricingReads, 1);
  assert.equal(response.modules.parts.data.installedSerializedParts[0].price.unitPrice, "75");
  assert.equal(response.modules.diagnosisRepair.data.laborPrice.totalPrice, "200");
  assert.ok(response.workorderPricing);
  assert.equal(response.customerDocumentAccess, undefined);
});

test("Surveillance detail denial happens before detail or price loading", async () => {
  await assert.rejects(handleSurveillanceApi({ method: "GET" }, {}, new URL(`/api/surveillance/workorders/${WORKORDER_ID}`, "http://localhost"), {
    requestContext: { actor: { id: "viewer", role: "surveillance" } }, sendJson: () => assert.fail("no response"),
  }, {
    resolveModules: async () => { throw new Error("scope denied"); },
    loadDetail: async () => assert.fail("must authorize before loading detail"),
    readLaborPricing: async () => assert.fail("must authorize before loading prices"),
  }), /scope denied/);
});
