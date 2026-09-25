import assert from "node:assert/strict";
import test from "node:test";
import { handleActivityApi } from "./activity.routes.js";

const context = { actor: { id: "actor-1", name: "Alex", role: "office" }, companyIds: new Set(["company-1"]), locationIds: new Set(["location-1"]) };

test("activity route forwards only the authenticated context and bounded query inputs", async () => {
  const sent = [];
  let received;
  const handled = await handleActivityApi(
    { method: "GET" }, {},
    new URL("http://example.test/api/activity?category=inventory&page=2&pageSize=25"),
    { requestContext: context, sendJson: (_res, status, body) => sent.push({ status, body }) },
    { getUserActivity: async (requestContext, query) => { received = { requestContext, query }; return { items: [], total: 0, page: 2, pageSize: 25, hasMore: false }; } },
  );
  assert.equal(handled, true);
  assert.equal(received.requestContext, context);
  assert.deepEqual(received.query, { category: "inventory", page: "2", pageSize: "25" });
  assert.equal(sent[0].status, 200);
});

test("activity route ignores unrelated paths and unsupported methods", async () => {
  const helpers = { requestContext: context, sendJson: () => assert.fail("must not send") };
  assert.equal(await handleActivityApi({ method: "GET" }, {}, new URL("http://x/api/other"), helpers), false);
  assert.equal(await handleActivityApi({ method: "POST" }, {}, new URL("http://x/api/activity"), helpers), false);
});
