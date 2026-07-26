import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkorderOperationsQuery } from "./workorder-operations.schemas.js";
import { queryAuthorizedWorkorders, summarizeAuthorizedWorkorders } from "./workorder-operations.service.js";

const locationA = "11111111-1111-4111-8111-111111111111";
const locationB = "22222222-2222-4222-8222-222222222222";
const mechanicId = "33333333-3333-4333-8333-333333333333";

function context(role, { locations = [], companies = ["default"], id = mechanicId } = {}) {
  return {
    actor: { id, role },
    companyIds: new Set(companies),
    locationIds: new Set(locations),
  };
}

test("admin query spans authorized company locations without a browser actor id", async () => {
  let received;
  const result = await queryAuthorizedWorkorders(context("admin", { locations: [locationA] }), { category: "all" }, {
    queryWorkorders: async (input) => { received = input; return { items: [], total: 0 }; },
  });
  assert.equal(result.total, 0);
  assert.deepEqual(received.companyIds, ["default"]);
  assert.deepEqual(received.locationIds, []);
  assert.equal(received.actorUserId, mechanicId);
  assert.equal(received.visibility, "operations");
});

test("office query is limited to assigned locations", async () => {
  let received;
  await queryAuthorizedWorkorders(context("office", { locations: [locationA, locationB] }), { category: "active" }, {
    queryWorkorders: async (input) => { received = input; return { items: [] }; },
  });
  assert.deepEqual(received.locationIds, [locationA, locationB]);
  assert.equal(received.category, "active");
});

test("mechanic query carries own-or-available isolation", async () => {
  let received;
  await queryAuthorizedWorkorders(context("mechanic", { locations: [locationA] }), { category: "all" }, {
    queryWorkorders: async (input) => { received = input; return { items: [] }; },
  });
  assert.equal(received.visibility, "mechanic");
  assert.equal(received.actorUserId, mechanicId);
});

test("surveillance query receives its role visibility boundary", async () => {
  let received;
  await queryAuthorizedWorkorders(context("surveillance", { locations: [locationA] }), { category: "all" }, {
    queryWorkorders: async (input) => { received = input; return { items: [] }; },
  });
  assert.equal(received.visibility, "surveillance");
});

test("inaccessible location is hidden", async () => {
  await assert.rejects(
    queryAuthorizedWorkorders(context("office", { locations: [locationA] }), { category: "all", locationId: locationB }, {
      getLocation: async () => ({ id: locationB, company_id: "default" }),
      queryWorkorders: async () => ({ items: [] }),
    }),
    (error) => error.statusCode === 404,
  );
});

test("attention projection and summary values pass through the shared service", async () => {
  const projected = { id: "wo-1", lifecycle: "in_progress", attentionReasons: ["parts", "overdue"] };
  const list = await queryAuthorizedWorkorders(context("admin"), { category: "needs_attention" }, {
    queryWorkorders: async () => ({ items: [projected], total: 1 }),
  });
  assert.deepEqual(list.items[0].attentionReasons, ["parts", "overdue"]);

  const summary = await summarizeAuthorizedWorkorders(context("admin"), {}, {
    summarizeWorkorders: async () => ({ needsAttention: 1, unassigned: 0, active: 1, parts: 1, readyReview: 0, odooBacklog: 0, all: 1 }),
  });
  assert.equal(summary.needsAttention, 1);
  assert.equal(summary.parts, 1);
});

test("query parser validates pagination, filters, and sorting", () => {
  const query = parseWorkorderOperationsQuery(new URLSearchParams({
    category: "parts",
    lifecycle: "accepted,in_progress",
    attentionReason: "parts",
    page: "3",
    pageSize: "25",
    sortBy: "timeInStatus",
    sortDirection: "asc",
  }));
  assert.deepEqual(query.lifecycle, ["accepted", "in_progress"]);
  assert.equal(query.page, 3);
  assert.equal(query.pageSize, 25);
  assert.equal(query.sortBy, "timeInStatus");
  assert.throws(() => parseWorkorderOperationsQuery(new URLSearchParams({ pageSize: "500" })));
});
