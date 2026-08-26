import assert from "node:assert/strict";
import test from "node:test";

import {
  readUnitServiceHistory,
  serviceHistoryFreshness,
} from "./unit-service-history.service.js";

const context = {
  actor: { id: "mechanic-1", role: "mechanic" },
  companyIds: new Set(["22222222-2222-4222-8222-222222222222"]),
  companyRoles: new Map([["22222222-2222-4222-8222-222222222222", "mechanic"]]),
  locationIds: new Set(["44444444-4444-4444-8444-444444444444"]),
};

function authorizedWorkorder(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "22222222-2222-4222-8222-222222222222",
    locationId: "44444444-4444-4444-8444-444444444444",
    assetId: "33333333-3333-4333-8333-333333333333",
    formData: { unitNo: "G2116" },
    asset: { id: "33333333-3333-4333-8333-333333333333", unitNo: "G2116", make: "Freightliner" },
    ...overrides,
  };
}

test("unit history authorizes Unit read before deriving tenant and exact asset from workorder", async () => {
  const calls = [];
  const workorder = authorizedWorkorder();
  const response = await readUnitServiceHistory(context, workorder.id, { limit: "5", cursor: "cursor-one" }, {
    loadWorkorder: async () => workorder,
    requireAccess: async () => workorder,
    authorize: async (...args) => {
      calls.push(["authorize", ...args]);
      return { workorder };
    },
    now: new Date("2026-08-24T12:00:00.000Z"),
    readSyncState: async (...args) => {
      calls.push(["sync", ...args]);
      return { lastSucceededAt: "2026-08-24T10:00:00.000Z" };
    },
    listHistory: async (...args) => {
      calls.push(["history", ...args]);
      return {
        items: [{ id: "history-1", serviceDate: "2026-08-20T00:00:00Z" }],
        historyCount: 1,
        lastCompletedServiceAt: "2026-08-20T00:00:00Z",
        latestRecordedServiceAt: "2026-08-19T00:00:00Z",
        nextCursor: null,
      };
    },
  });
  assert.equal(calls[0][0], "authorize");
  assert.deepEqual(calls[0][3], {
    moduleKey: "unit",
    capability: "read",
    resourceAccess: {},
  });
  assert.deepEqual(calls.find(([kind]) => kind === "history").slice(1), [
    workorder.companyId,
    workorder.assetId,
    workorder.id,
    { limit: 5, cursor: "cursor-one" },
  ]);
  assert.deepEqual(response, {
    state: "ready",
    unit: {
      assetId: workorder.assetId, unitNo: "G2116", name: "", make: "Freightliner",
      model: "", year: null, mileage: null,
    },
    summary: {
      historyCount: 1,
      returnedCount: 1,
      lastCompletedServiceAt: "2026-08-20T00:00:00Z",
      latestRecordedServiceAt: "2026-08-19T00:00:00Z",
    },
    freshness: {
      state: "current",
      checkedAt: response.freshness.checkedAt,
      lastAttemptedAt: null,
      lastSucceededAt: "2026-08-24T10:00:00.000Z",
      lastErrorAt: null,
      errorCode: "",
      warning: "",
    },
    items: [{ id: "history-1", serviceDate: "2026-08-20T00:00:00Z" }],
    nextCursor: null,
  });
  assert.equal(response.unit.unitNo, "G2116");
});

test("denied Unit access performs no history or sync reads", async () => {
  const calls = [];
  await assert.rejects(readUnitServiceHistory(context, "wo-1", {}, {
    loadWorkorder: async () => authorizedWorkorder(),
    requireAccess: async () => authorizedWorkorder(),
    authorize: async () => { calls.push("authorize"); throw new Error("denied"); },
    readSyncState: async () => { calls.push("sync"); },
    listHistory: async () => { calls.push("history"); },
  }), /denied/);
  assert.deepEqual(calls, ["authorize"]);
});

test("workorder without exact asset is unlinked and never performs an ambiguous history lookup", async () => {
  let listed = false;
  const response = await readUnitServiceHistory(context, "wo-1", {}, {
    loadWorkorder: async () => authorizedWorkorder({ assetId: null, asset: null }),
    requireAccess: async (_context, _id, options) => options.getWorkorder(),
    authorize: async (_context, _id, _options, dependencies) => ({
      workorder: await dependencies.requireAccess(),
    }),
    readSyncState: async () => ({}),
    listHistory: async () => { listed = true; },
  });
  assert.equal(listed, false);
  assert.equal(response.state, "unlinked");
  assert.equal(response.summary.historyCount, 0);
});

test("feature defense rejects empty location scope even if the shared authorization returns a workorder", async () => {
  await assert.rejects(readUnitServiceHistory({
    ...context,
    locationIds: new Set(),
  }, "wo-1", {}, {
    loadWorkorder: async () => authorizedWorkorder(),
    authorize: async () => ({ workorder: authorizedWorkorder() }),
    readSyncState: async () => assert.fail("strict resource defense runs before data reads"),
  }), (error) => error.statusCode === 404);
});

for (const status of ["open", "accepted", "in_progress"]) {
  test(`mechanic cannot read ${status} unit history unless assigned`, async () => {
    await assert.rejects(readUnitServiceHistory(context, "wo-1", {}, {
      loadWorkorder: async () => authorizedWorkorder({
        status,
        mechanicIds: ["mechanic-2"],
      }),
      readSyncState: async () => assert.fail("assignment denial runs before data reads"),
      listHistory: async () => assert.fail("assignment denial runs before data reads"),
    }), (error) => error.statusCode === 404);
  });
}

test("company-effective role is authorized directly instead of trusting the actor primary role", async () => {
  const roles = [];
  const officeContext = {
    ...context,
    actor: { id: "actor-1", role: "admin" },
    companyRoles: new Map([["22222222-2222-4222-8222-222222222222", "office"]]),
  };
  await readUnitServiceHistory(officeContext, "wo-1", {}, {
    loadWorkorder: async () => authorizedWorkorder(),
    requireAccess: async (authorizedContext) => {
      roles.push(`resource:${authorizedContext.actor.role}`);
      return authorizedWorkorder();
    },
    authorize: async (authorizedContext) => {
      roles.push(`module:${authorizedContext.actor.role}`);
      return { workorder: authorizedWorkorder() };
    },
    readSyncState: async () => ({ lastSucceededAt: "2026-08-24T10:00:00Z" }),
    listHistory: async () => ({
      items: [], historyCount: 0, lastCompletedServiceAt: null,
      latestRecordedServiceAt: null, nextCursor: null,
    }),
  });
  assert.deepEqual(roles, ["resource:office", "module:office"]);
});

test("lower global role does not falsely deny a target-company admin Unit grant", async () => {
  const roles = [];
  const targetAdminContext = {
    ...context,
    actor: { id: "actor-1", role: "mechanic" },
    companyRoles: new Map([["22222222-2222-4222-8222-222222222222", "admin"]]),
    locationIds: new Set(),
  };
  await readUnitServiceHistory(targetAdminContext, "wo-1", {}, {
    loadWorkorder: async () => authorizedWorkorder(),
    requireAccess: async (authorizedContext) => {
      roles.push(`resource:${authorizedContext.actor.role}`);
      return authorizedWorkorder();
    },
    authorize: async (authorizedContext) => {
      roles.push(`module:${authorizedContext.actor.role}`);
      return { workorder: authorizedWorkorder() };
    },
    readSyncState: async () => ({ lastSucceededAt: "2026-08-24T10:00:00Z" }),
    listHistory: async () => ({
      items: [], historyCount: 0, lastCompletedServiceAt: null,
      latestRecordedServiceAt: null, nextCursor: null,
    }),
  });
  assert.deepEqual(roles, ["resource:admin", "module:admin"]);
});

test("freshness never presents a failed projection as fresh empty", () => {
  assert.equal(serviceHistoryFreshness({}).state, "never_synced");
  assert.equal(serviceHistoryFreshness({
    lastAttemptedAt: "2026-08-24T11:00:00Z",
    lastErrorAt: "2026-08-24T11:00:01Z",
    lastErrorCode: "ODOO_SERVICE_HISTORY_UNAVAILABLE",
  }).state, "unavailable");
  assert.equal(serviceHistoryFreshness({
    lastAttemptedAt: "2026-08-24T11:00:00Z",
    lastSucceededAt: "2026-08-23T11:00:00Z",
    lastErrorAt: "2026-08-24T11:00:01Z",
  }).state, "stale");
  assert.equal(serviceHistoryFreshness({
    lastAttemptedAt: "2026-08-24T11:00:00Z",
    lastSucceededAt: "2026-08-24T11:00:01Z",
  }, new Date("2026-08-24T12:00:00Z")).state, "current");
  const expired = serviceHistoryFreshness({
    lastAttemptedAt: "2026-08-22T11:00:00Z",
    lastSucceededAt: "2026-08-22T11:00:01Z",
  }, new Date("2026-08-24T12:00:00Z"));
  assert.equal(expired.state, "stale");
  assert.equal(expired.errorCode, "SERVICE_HISTORY_SYNC_STALE");
  assert.match(expired.warning, /more than 24 hours old/i);
});

test("never-synced is distinct from provider unavailable when no local history exists", async () => {
  const response = await readUnitServiceHistory(context, "wo-1", {}, {
    loadWorkorder: async () => authorizedWorkorder(),
    requireAccess: async () => authorizedWorkorder(),
    authorize: async () => ({ workorder: authorizedWorkorder() }),
    readSyncState: async () => ({}),
    listHistory: async () => ({
      items: [], historyCount: 0, lastCompletedServiceAt: null,
      latestRecordedServiceAt: null, nextCursor: null,
    }),
  });
  assert.equal(response.state, "never_synced");
  assert.equal(response.freshness.state, "never_synced");
});

test("history limit is bounded before repository access", async () => {
  await assert.rejects(readUnitServiceHistory(context, "wo-1", { limit: "51" }, {
    loadWorkorder: async () => authorizedWorkorder(),
    requireAccess: async () => authorizedWorkorder(),
    authorize: async () => ({ workorder: authorizedWorkorder() }),
    readSyncState: async () => ({}),
    listHistory: async () => assert.fail("invalid limit must not query history"),
  }), (error) => error.statusCode === 400);
});
