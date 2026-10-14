import assert from "node:assert/strict";
import test from "node:test";
import { handleIntegrationsApi, integrationRouteInternals } from "./integrations.routes.js";

const ADMIN_COMPANY = "11111111-1111-4111-8111-111111111111";
const MECHANIC_COMPANY = "22222222-2222-4222-8222-222222222222";

function context() {
  return {
    actor: { id: "user-1", role: "admin" },
    companyIds: new Set([MECHANIC_COMPANY, ADMIN_COMPANY]),
    companyRoles: new Map([[MECHANIC_COMPANY, "mechanic"], [ADMIN_COMPANY, "admin"]]),
    sessionMode: "standard",
  };
}

test("integration routes default to an effective Admin company, not the first membership", () => {
  const selected = integrationRouteInternals.selectedCompanyId(
    new URL("https://workorders.example.com/api/integrations/odoo/status"),
    context(),
  );
  assert.equal(selected, ADMIN_COMPANY);
});

test("integration routes reject an explicit lower-role company", () => {
  assert.throws(
    () => integrationRouteInternals.selectedCompanyId(
      new URL(`https://workorders.example.com/api/integrations/odoo/status?companyId=${MECHANIC_COMPANY}`),
      context(),
    ),
    (error) => error.statusCode === 403,
  );
  assert.equal(
    integrationRouteInternals.selectedCompanyId(
      new URL(`https://workorders.example.com/api/integrations/odoo/status?companyId=${ADMIN_COMPANY}`),
      context(),
    ),
    ADMIN_COMPANY,
  );
});

test("a denied integration company stops before response or provider work", async () => {
  let sent = false;
  await assert.rejects(
    handleIntegrationsApi(
      { method: "GET" },
      {},
      new URL(`https://workorders.example.com/api/integrations/odoo/status?companyId=${MECHANIC_COMPANY}`),
      {
        requestContext: context(),
        sendJson: () => { sent = true; },
        readBody: async () => assert.fail("denied GET must not read a body"),
      },
    ),
    (error) => error.statusCode === 403,
  );
  assert.equal(sent, false);
});
