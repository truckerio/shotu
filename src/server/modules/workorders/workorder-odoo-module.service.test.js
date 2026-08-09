import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeWorkorderOdooModule,
  createWorkorderOdooDraft,
  markWorkorderOdooMissingInfo,
  prepareWorkorderOdooModule,
  workorderOdooReadiness,
} from "./workorder-odoo-module.service.js";

const WORKORDER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";

function context(role, id = `${role}-user`) {
  return { actor: { id, role } };
}

function dependencies({ status = "closed", policy = null, ...overrides } = {}) {
  return {
    requireAccess: async () => ({
      id: WORKORDER_ID,
      companyId: COMPANY_ID,
      locationId: LOCATION_ID,
      status,
    }),
    getPolicy: async () => policy,
    ...overrides,
  };
}

test("Admin and Surveillance can write the eligible Odoo module by default", async () => {
  for (const role of ["admin", "surveillance"]) {
    const authorization = await authorizeWorkorderOdooModule(
      context(role),
      WORKORDER_ID,
      { write: true },
      dependencies(),
    );
    assert.equal(authorization.access, "write");
    assert.equal(authorization.companyId, COMPANY_ID);
  }
});

test("Office and Mechanic cannot read the Odoo module by default", async () => {
  for (const role of ["office", "mechanic"]) {
    await assert.rejects(
      authorizeWorkorderOdooModule(context(role), WORKORDER_ID, {}, dependencies()),
      (error) => error.statusCode === 403 && error.code === "PERMISSION_DENIED",
    );
  }
});

test("user override wins over role policy and read access cannot mutate", async () => {
  const actor = context("office", "office-one");
  const policy = {
    moduleAccess: { office: { detail: { odoo: "hidden" } } },
    userModuleAccess: { "office-one": { detail: { odoo: "read" } } },
  };
  const deps = dependencies({ policy });

  const authorization = await authorizeWorkorderOdooModule(actor, WORKORDER_ID, {}, deps);
  assert.equal(authorization.access, "read");
  await assert.rejects(
    authorizeWorkorderOdooModule(actor, WORKORDER_ID, { write: true }, deps),
    (error) => error.statusCode === 403,
  );
});

test("module authorization rejects work before provider calls when lifecycle is ineligible", async () => {
  let readinessCalls = 0;
  await assert.rejects(
    workorderOdooReadiness(context("admin"), WORKORDER_ID, dependencies({
      status: "mechanic_done",
      readiness: async () => {
        readinessCalls += 1;
      },
    })),
    (error) => error.statusCode === 409 && error.code === "WORKORDER_NOT_ELIGIBLE",
  );
  assert.equal(readinessCalls, 0);
});

test("readiness preserves company-scoped provider input after resource access", async () => {
  let providerInput = null;
  const result = await workorderOdooReadiness(context("admin"), WORKORDER_ID, dependencies({
    readiness: async (input) => {
      providerInput = input;
      return { ready: true };
    },
  }));

  assert.deepEqual(providerInput, { companyId: COMPANY_ID, workorderId: WORKORDER_ID });
  assert.deepEqual(result, { ready: true });
});

test("write operations pass authenticated actor identity and bounded inputs", async () => {
  const actor = context("surveillance", "surveillance-one");
  let preparationInput = null;
  let draftInput = null;
  const deps = dependencies({
    prepare: async (input) => {
      preparationInput = input;
      return { readiness: { ready: true } };
    },
    createDraft: async (input) => {
      draftInput = input;
      return { serviceOrderNumber: "S0001" };
    },
  });

  await prepareWorkorderOdooModule(actor, WORKORDER_ID, {
    laborHours: 2.5,
    customerExternalId: "41",
  }, deps);
  await createWorkorderOdooDraft(actor, WORKORDER_ID, {
    expectedUpdatedAt: "2026-08-08T10:00:00.000Z",
    requestId: "request-one",
  }, deps);

  assert.deepEqual(preparationInput, {
    companyId: COMPANY_ID,
    workorderId: WORKORDER_ID,
    userId: "surveillance-one",
    input: { laborHours: 2.5, customerExternalId: "41" },
  });
  assert.deepEqual(draftInput, {
    companyId: COMPANY_ID,
    workorderId: WORKORDER_ID,
    userId: "surveillance-one",
    requestId: "request-one",
    input: { expectedUpdatedAt: "2026-08-08T10:00:00.000Z" },
  });
});

test("missing information uses the authenticated actor and updates attention", async () => {
  const actor = context("admin", "admin-one");
  let queryValues = null;
  let attention = null;
  const entry = await markWorkorderOdooMissingInfo(actor, WORKORDER_ID, { note: "Need VIN" }, dependencies({
    query: async (_sql, values) => {
      queryValues = values;
      return { rows: [{ status: "missing_info", note: values[1] }] };
    },
    setAttention: async (input) => {
      attention = input;
    },
  }));

  assert.deepEqual(queryValues, [WORKORDER_ID, "Need VIN"]);
  assert.equal(attention.actorUserId, "admin-one");
  assert.equal(attention.workorderId, WORKORDER_ID);
  assert.deepEqual(entry, { status: "missing_info", note: "Need VIN" });
});
