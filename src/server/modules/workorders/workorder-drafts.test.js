import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WorkorderDraftConflictError,
  WorkorderDraftLimitError,
  publicWorkorderDraftRow,
  submitWorkorderDraftInTransaction,
} from "../../db/repositories/workorder-drafts.repo.js";
import {
  createWorkorderDraftSchema,
  submitWorkorderDraftSchema,
  takeoverWorkorderDraftSchema,
  updateWorkorderDraftSchema,
} from "./workorder-drafts.schemas.js";
import {
  createUserWorkorderDraft,
  submitUserWorkorderDraft,
  takeoverUserWorkorderDraft,
  updateUserWorkorderDraft,
} from "./workorder-drafts.service.js";

const actorId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const locationId = "33333333-3333-4333-8333-333333333333";
const draftId = "44444444-4444-4444-8444-444444444444";
const workorderId = "55555555-5555-4555-8555-555555555555";

function context(role = "office") {
  return {
    actor: { id: actorId, role },
    companyIds: new Set([companyId]),
    locationIds: new Set([locationId]),
  };
}

function draftRow(overrides = {}) {
  return {
    id: draftId,
    company_id: companyId,
    location_id: locationId,
    created_by_user_id: actorId,
    type: "workorder",
    status: "active",
    version: 2,
    payload: { concern: "Inspect an air leak." },
    updated_at: "2026-07-25T12:00:00.000Z",
    submitted_workorder_id: null,
    ...overrides,
  };
}

test("draft schemas allow incomplete autosave snapshots but require optimistic versions", () => {
  assert.equal(createWorkorderDraftSchema.parse({
    type: "workorder",
    payload: { formData: { unitNo: "G2001" } },
  }).locationId, undefined);
  assert.deepEqual(createWorkorderDraftSchema.parse({
    type: "workorder",
    locationId,
    payload: { formData: { unitNo: "G2001" } },
  }).payload.formData, { unitNo: "G2001" });
  assert.equal(updateWorkorderDraftSchema.parse({ version: 3, payload: { concern: "" } }).version, 3);
  assert.deepEqual(submitWorkorderDraftSchema.parse({}), {});
  assert.equal(takeoverWorkorderDraftSchema.parse({ version: 3 }).version, 3);
  assert.throws(() => takeoverWorkorderDraftSchema.parse({}));
  assert.throws(() => updateWorkorderDraftSchema.parse({ version: 0, payload: {} }));
  assert.throws(() => createWorkorderDraftSchema.parse({ type: "inventory", locationId, payload: {} }));
});

test("a location-free draft derives its company from the actor membership", async () => {
  let received;
  await createUserWorkorderDraft(context(), {
    type: "workorder",
    payload: { formData: { unitNo: "G2001" } },
  }, {
    createDraft: async (input) => {
      received = input;
      return { id: draftId };
    },
  });
  assert.equal(received.companyId, companyId);
  assert.equal(received.locationId, null);
});

test("draft creation derives tenant and user ownership from the authenticated location", async () => {
  let received;
  const draft = await createUserWorkorderDraft(context(), {
    type: "workorder",
    locationId,
    payload: { companyId: "browser-value", concern: "Draft concern" },
  }, {
    getLocation: async () => ({ id: locationId, company_id: companyId }),
    createDraft: async (input) => {
      received = input;
      return { id: draftId };
    },
  });

  assert.equal(draft.id, draftId);
  assert.equal(received.companyId, companyId);
  assert.equal(received.userId, actorId);
  assert.equal(received.payload.companyId, "browser-value");
});

test("mechanics cannot use the server-owned workorder draft lifecycle", async () => {
  await assert.rejects(
    createUserWorkorderDraft(context("mechanic"), {
      type: "workorder",
      locationId,
      payload: {},
    }),
    (error) => error.statusCode === 403 && error.code === "PERMISSION_DENIED",
  );
});

test("draft updates cannot move between companies and map version conflicts to HTTP 409", async () => {
  await assert.rejects(
    updateUserWorkorderDraft(context(), draftId, {
      version: 2,
      locationId,
    }, {
      getOwnership: async () => ({ companyId, locationId, status: "active" }),
      getLocation: async () => ({ id: locationId, company_id: "66666666-6666-4666-8666-666666666666" }),
    }),
    (error) => error.statusCode === 400 && /another company/i.test(error.message),
  );

  await assert.rejects(
    updateUserWorkorderDraft(context(), draftId, {
      version: 1,
      payload: { concern: "stale" },
    }, {
      getOwnership: async () => ({ companyId, locationId, status: "active" }),
      updateDraft: async () => {
        throw new WorkorderDraftConflictError("DRAFT_VERSION_CONFLICT", "Changed elsewhere.");
      },
    }),
    (error) => error.statusCode === 409 && error.code === "DRAFT_VERSION_CONFLICT",
  );
});

test("draft metadata is ready for a shared queue without exposing raw ownership fields", () => {
  const row = publicWorkorderDraftRow({
    id: draftId,
    company_id: companyId,
    location_id: locationId,
    created_by_user_id: actorId,
    owner_user_id: actorId,
    last_edited_by_user_id: actorId,
    creator_name: "Office One",
    owner_name: "Office One",
    last_editor_name: "Office One",
    location_name: "Chino Yard",
    type: "workorder",
    status: "active",
    version: 4,
    payload: {
      formData: { unitNo: "G2001", customerCompanyName: "Long Haul" },
      concern: "Inspect brakes.",
    },
    created_at: "2026-07-25T11:00:00.000Z",
    updated_at: "2026-07-25T12:00:00.000Z",
    submitted_workorder_id: null,
  });
  assert.deepEqual(row.location, { id: locationId, name: "Chino Yard" });
  assert.equal(row.unit, "G2001");
  assert.equal(row.concern, "Inspect brakes.");
  assert.deepEqual(row.missingFields, []);
  assert.equal(row.creator.name, "Office One");
  assert.equal(row.owner.name, "Office One");
  assert.equal(row.lastEditedBy.name, "Office One");
});

test("office lists assigned-location drafts while admin receives all authorized-company drafts", async () => {
  const calls = [];
  const listDrafts = async (input) => {
    calls.push(input);
    return [];
  };
  await import("./workorder-drafts.service.js").then(({ listUserWorkorderDrafts }) =>
    listUserWorkorderDrafts(context("office"), { type: "workorder" }, { listDrafts }));
  await import("./workorder-drafts.service.js").then(({ listUserWorkorderDrafts }) =>
    listUserWorkorderDrafts(context("admin"), { type: "workorder" }, { listDrafts }));
  assert.deepEqual(calls.map(({ role, locationIds }) => ({ role, locationIds })), [
    { role: "office", locationIds: [locationId] },
    { role: "admin", locationIds: [locationId] },
  ]);
});

test("takeover is atomic at the service boundary and mechanics remain forbidden", async () => {
  const nextOwnerId = "77777777-7777-4777-8777-777777777777";
  let received;
  const draft = await takeoverUserWorkorderDraft({
    actor: { id: nextOwnerId, role: "admin" },
    companyIds: new Set([companyId]),
    locationIds: new Set([locationId]),
  }, draftId, { version: 4 }, {
    takeover: async (input) => {
      received = input;
      return { id: draftId, version: 5, ownerId: nextOwnerId };
    },
  });
  assert.equal(draft.ownerId, nextOwnerId);
  assert.equal(received.version, 4);
  await assert.rejects(
    takeoverUserWorkorderDraft(context("office"), draftId, { version: 4 }, { takeover: async () => ({}) }),
    (error) => error.statusCode === 403 && error.code === "PERMISSION_DENIED",
  );
  await assert.rejects(
    takeoverUserWorkorderDraft(context("mechanic"), draftId, { version: 4 }, { takeover: async () => ({}) }),
    (error) => error.statusCode === 403 && error.code === "PERMISSION_DENIED",
  );
});

test("active draft limit is returned as an actionable conflict", async () => {
  await assert.rejects(
    createUserWorkorderDraft(context(), { type: "workorder", payload: {} }, {
      createDraft: async () => { throw new WorkorderDraftLimitError(); },
    }),
    (error) => error.statusCode === 409 && error.code === "DRAFT_LIMIT_REACHED",
  );
});

test("submission locks the draft before creating and marks it submitted in the same transaction", async () => {
  const events = [];
  const client = {
    async query(sql, params) {
      if (/select \*[\s\S]*from workorder_drafts[\s\S]*for update/i.test(sql)) {
        events.push("lock");
        return { rows: [draftRow()] };
      }
      if (/update workorder_drafts[\s\S]*status = 'submitted'/i.test(sql)) {
        events.push("submit");
        assert.equal(params[1], workorderId);
        return {
          rows: [draftRow({
            status: "submitted",
            version: 3,
            submitted_workorder_id: workorderId,
          })],
        };
      }
      if (/insert into workorder_draft_events/i.test(sql)) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const result = await submitWorkorderDraftInTransaction({
    id: draftId,
    companyIds: [companyId],
    userId: actorId,
    version: 2,
    prepareCreateInput: async (draft) => {
      events.push("validate");
      assert.equal(draft.companyId, companyId);
      return { concern: draft.payload.concern };
    },
  }, client, {
    createWorkorder: async () => {
      events.push("create");
      return { id: workorderId, serial: "WO-000001" };
    },
  });

  assert.deepEqual(events, ["lock", "validate", "create", "submit"]);
  assert.equal(result.draft.submittedWorkorderId, workorderId);
  assert.equal(result.idempotent, false);
});

test("repeated submission returns the original workorder without creating another serial", async () => {
  let creates = 0;
  const client = {
    async query(sql) {
      assert.match(sql, /for update/i);
      return {
        rows: [draftRow({
          status: "submitted",
          version: 3,
          submitted_workorder_id: workorderId,
        })],
      };
    },
  };
  const result = await submitWorkorderDraftInTransaction({
    id: draftId,
    companyIds: [companyId],
    userId: actorId,
    version: 1,
    prepareCreateInput: async () => {
      throw new Error("Submitted drafts must not be validated again.");
    },
  }, client, {
    createWorkorder: async () => {
      creates += 1;
      return { id: "unexpected" };
    },
  });

  assert.equal(creates, 0);
  assert.equal(result.workorderId, workorderId);
  assert.equal(result.idempotent, true);
});

test("final validation ignores browser tenant fields and happens before workorder creation", async () => {
  let createCalls = 0;
  await assert.rejects(
    submitUserWorkorderDraft(context(), draftId, { version: 2 }, {
      getLocation: async () => ({ id: locationId, company_id: companyId }),
      submitDraft: async (input) => {
        await input.prepareCreateInput({
          id: draftId,
          companyId,
          createdByUserId: actorId,
          locationId,
          payload: {
            companyId: "66666666-6666-4666-8666-666666666666",
            concern: "",
          },
        });
        createCalls += 1;
      },
    }),
    (error) => error.statusCode === 400 && /concern is required/i.test(error.message),
  );
  assert.equal(createCalls, 0);
});

test("draft submission accepts the canonical database company UUID", async () => {
  let preparedInput;
  const canonicalCompanyId = "00000000-0000-0000-0000-000000000001";

  await submitUserWorkorderDraft({
    ...context(),
    companyIds: new Set([canonicalCompanyId]),
  }, draftId, { version: 2 }, {
    getLocation: async () => ({ id: locationId, company_id: canonicalCompanyId }),
    submitDraft: async (input) => {
      preparedInput = await input.prepareCreateInput({
        id: draftId,
        companyId: canonicalCompanyId,
        createdByUserId: actorId,
        locationId,
        payload: {
          concern: "Inspect coolant leak.",
          mechanicUserIds: [],
          formData: {},
        },
      });
      return { draft: { id: draftId }, workorder: { id: workorderId } };
    },
  });

  assert.equal(preparedInput.companyId, canonicalCompanyId);
  assert.equal(preparedInput.locationId, locationId);
});

test("migration stores no serial and enforces tenant-safe submission references", async () => {
  const migration = await readFile(
    new URL("../../db/migrations/020_workorder_drafts.sql", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(migration, /^\s*serial\s+/m);
  assert.match(migration, /foreign key \(company_id, location_id\)/);
  assert.match(migration, /foreign key \(company_id, submitted_workorder_id\)/);
  assert.match(migration, /status = 'submitted' and submitted_workorder_id is not null/);
  const collaboration = await readFile(
    new URL("../../db/migrations/021_workorder_draft_collaboration.sql", import.meta.url),
    "utf8",
  );
  assert.match(collaboration, /owner_user_id/);
  assert.match(collaboration, /last_edited_by_user_id/);
  assert.match(collaboration, /create table if not exists workorder_draft_events/);
  assert.match(collaboration, /taken_over/);
});
