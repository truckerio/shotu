import assert from "node:assert/strict";
import test from "node:test";
import { assertWorkorderAuthorizationPolicy } from "./operational-workorders.repo.js";
import { assertCurrentExternalEstimateAccepted } from "./workorder-customer-authorization.repo.js";

const base = {
  companyId: "11111111-1111-4111-8111-111111111111",
  locationId: "22222222-2222-4222-8222-222222222222",
};

test("shared Workorder boundary audits legacy trusted callers and rejects unaudited explicit paths", async () => {
  const client = { query: async () => assert.fail("invalid policy must fail before querying") };
  const legacy = await assertWorkorderAuthorizationPolicy(base, client);
  assert.equal(legacy.authority, "legacy_server_repository");
  assert.equal(legacy.classification, "internal_fleet");
  await assert.rejects(assertWorkorderAuthorizationPolicy({ ...base, authorizationClassification: "required_external_customer" }, client),
    (error) => error.code === "CUSTOMER_ESTIMATE_ACCEPTANCE_REQUIRED");
  await assert.rejects(assertWorkorderAuthorizationPolicy({
    ...base, authorizationClassification: "internal_fleet", activationPolicy: "legacy_internal_fleet_direct_v1", createdByRole: "office",
  }, client), (error) => error.code === "WORKORDER_AUTHORIZATION_EXCEPTION_INVALID");
});

test("shared Workorder boundary accepts only database-verified Estimate evidence for external customers", async () => {
  let query;
  await assertWorkorderAuthorizationPolicy({
    ...base,
    authorizationClassification: "required_external_customer",
    activationPolicy: "accepted_customer_estimate_v1",
    acceptedEstimateRevisionId: "33333333-3333-4333-8333-333333333333",
    authorizationSourceDraftId: "44444444-4444-4444-8444-444444444444",
    pricing: { expectedFingerprint: "a".repeat(64) },
  }, { query: async (text, params) => (query = { text, params }, { rows: [{ id: params[2] }] }) });
  assert.match(query.text, /event_type='accepted'/);
  assert.match(query.text, /event_type in \('declined','changes_requested','voided','superseded'\)/);
  assert.deepEqual(query.params, [base.companyId, base.locationId, "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444", "a".repeat(64), null]);
});

test("explicit exceptions require Admin or a server-owned mechanic/system authority", async () => {
  const client = { query: async () => assert.fail("exceptions do not query customer documents") };
  const admin = await assertWorkorderAuthorizationPolicy({
    ...base, authorizationClassification: "internal_fleet", authorizationExceptionReason: "Admin fleet decision",
    activationPolicy: "legacy_internal_fleet_direct_v1", createdByRole: "admin",
  }, client);
  assert.equal(admin.authority, "admin");
  const mechanic = await assertWorkorderAuthorizationPolicy({
    ...base, authorizationClassification: "internal_fleet", authorizationExceptionReason: "Server-owned mechanic self-create workflow",
    activationPolicy: "legacy_internal_fleet_direct_v1", createdByRole: "mechanic", authorizationAuthority: "mechanic_self_create",
  }, client);
  assert.equal(mechanic.authority, "mechanic_self_create");
});

test("mechanic internal exception fails closed for a named asset owner outside the tenant", async () => {
  const input = {
    ...base,
    assetId: "33333333-3333-4333-8333-333333333333",
    authorizationClassification: "internal_fleet",
    authorizationExceptionReason: "Server-owned mechanic self-create workflow",
    activationPolicy: "legacy_internal_fleet_direct_v1",
    createdByRole: "mechanic",
    authorizationAuthority: "mechanic_self_create",
  };
  await assert.rejects(assertWorkorderAuthorizationPolicy(input, {
    query: async () => ({ rows: [{ owner_name: "External Customer", company_name: "Fleet Tenant" }] }),
  }), (error) => error.code === "CUSTOMER_ESTIMATE_ACCEPTANCE_REQUIRED");
  const allowed = await assertWorkorderAuthorizationPolicy(input, {
    query: async () => ({ rows: [{ owner_name: "  FLEET   tenant ", company_name: "Fleet Tenant" }] }),
  });
  assert.equal(allowed.authority, "mechanic_self_create");
});

test("mechanic progress requires the latest revised Estimate to be accepted for external-customer work", async () => {
  const workorder = { id: "33333333-3333-4333-8333-333333333333", company_id: base.companyId };
  for (const row of [
    { classification: "required_external_customer", latest_revision_id: null, latest_accepted: false, latest_terminal: false },
    { classification: "required_external_customer", latest_revision_id: "revision", latest_accepted: false, latest_terminal: false },
    { classification: "required_external_customer", latest_revision_id: "revision", latest_accepted: true, latest_terminal: true },
  ]) {
    await assert.rejects(
      assertCurrentExternalEstimateAccepted({ query: async () => ({ rows: [row] }) }, {
        companyId: workorder.company_id, workorderId: workorder.id,
      }),
      (error) => error.code === "CUSTOMER_REVISED_ESTIMATE_ACCEPTANCE_REQUIRED",
    );
  }
  await assert.doesNotReject(assertCurrentExternalEstimateAccepted({ query: async () => ({ rows: [{
    classification: "required_external_customer", latest_revision_id: "revision", latest_accepted: true, latest_terminal: false,
  }] }) }, { companyId: workorder.company_id, workorderId: workorder.id }));
  await assert.doesNotReject(assertCurrentExternalEstimateAccepted({ query: async () => ({ rows: [{ classification: "internal_fleet" }] }) }, {
    companyId: workorder.company_id, workorderId: workorder.id,
  }));
});
