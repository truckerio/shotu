import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { respondToCustomerDocument } from "./customer-portal-api.js";

const page = readFileSync(new URL("./CustomerPortalPage.jsx", import.meta.url), "utf8");
const main = readFileSync(new URL("../../main.jsx", import.meta.url), "utf8");
const api = readFileSync(new URL("./customer-portal-api.js", import.meta.url), "utf8");
const grant = await import("./customer-portal-grant.js");

test("customer portal is fragment-grant-routed before staff authentication", () => {
  assert.match(main, /customerGrant \? \(/);
  assert.match(main, /customerPortalGrantFromLocation/);
  assert.match(main, /<CustomerPortalPage grant=\{customerGrant\}/);
});

test("portal tokens stay out of loggable request paths and use the dedicated header", () => {
  assert.equal(grant.customerPortalGrantFromLocation({ hash: "#customerDocument=fragment-token", search: "?customerDocument=query-token" }), "fragment-token");
  assert.equal(grant.customerPortalGrantFromLocation({ hash: "", search: "?customerDocument=query-token" }), "");
  assert.deepEqual(grant.customerPortalRequestHeaders("fragment-token"), { "x-customer-grant": "fragment-token" });
  assert.match(api, /"\/api\/customer-portal\/document"/);
  assert.match(api, /"\/api\/customer-portal\/responses"/);
  assert.match(api, /"\/api\/customer-portal\/chat"/);
  assert.doesNotMatch(api, /\?grant=/);
});

test("portal response keeps JSON content type when adding its grant header", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (path, options) => {
    request = { path, options };
    return { ok: true, json: async () => ({ eventId: "event-1" }) };
  };
  try {
    await respondToCustomerDocument({
      grant: "grant-token", response: "accepted", customerName: "Pat", note: "", idempotencyKey: "response-key",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(request.path, "/api/customer-portal/responses");
  assert.equal(request.options.headers["content-type"], "application/json");
  assert.equal(request.options.headers["x-customer-grant"], "grant-token");
});

test("customer discussion is capability-gated and explicitly not an authorization action", () => {
  assert.match(page, /allowedActions\?\.includes\("customer_chat"\)/);
  assert.match(page, /They do not approve or change the estimate/);
  assert.match(page, /sendCustomerDocumentChat/);
});

test("customer portal keeps consequential response context visible", () => {
  assert.match(page, /Your response applies only to/);
  assert.match(page, /Your name/);
  assert.match(page, /Confirm response/);
  assert.match(page, /Document unavailable/);
});

test("portal response actions fail closed without server eligibility and never return after a terminal response", () => {
  assert.match(page, /data\?\.approvalRequired === true/);
  assert.match(page, /grantCanRespond\(data\)/);
  assert.match(page, /response\.status === "pending"/);
  assert.match(page, /terminalResponses\.has\(response\.status\)/);
  assert.doesNotMatch(page, /allowedActions\?\.includes\("respond_revision"\)/);
});

test("informational estimates explicitly say that no approval is needed while retaining chat capability", () => {
  assert.match(page, /No approval needed/);
  assert.match(page, /no approval is required/);
});

test("portal polls only while respondable and revalidates immediately before confirmation", () => {
  assert.match(page, /setInterval\(refresh, 3000\)/);
  assert.match(page, /visibilitychange/);
  assert.match(page, /if \(!portalRespondable\(fresh, fresh\.document\)\)/);
  assert.match(page, /responseEligible: false/);
  assert.match(page, /grant\?\.responseEligible === true/);
});
