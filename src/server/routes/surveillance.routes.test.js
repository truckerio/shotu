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
