import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRole } from "../../auth/permissions.js";
import { createInventoryTaxProfile, listInventoryTaxProfiles, reviseInventoryTaxProfile, setInventoryTaxProfileArchived } from "./inventory-tax-profiles.service.js";

const companyId = "22222222-2222-4222-8222-222222222222";
const profileId = "33333333-3333-4333-8333-333333333333";
const actorId = "11111111-1111-4111-8111-111111111111";
const context = { actor: { id: actorId, role: "office" }, permissions: permissionsForRole("office"), companyIds: new Set([companyId]), locationIds: new Set() };
const body = { companyId, name: "Washington retail", currency: "USD", jurisdiction: "Washington", components: [{ name: "Sales tax", rate: "10.25", compound: false }], reason: "Initial profile", idempotencyKey: "profile-request-1" };

test("profile list and create require explicit authorized company scope", async () => {
  const listed = await listInventoryTaxProfiles(new URLSearchParams({ companyId, includeArchived: "false" }), context, { listTaxProfiles: async (input) => { assert.deepEqual(input, { companyId, includeArchived: false }); return []; } });
  assert.deepEqual(listed, { profiles: [] });
  await assert.rejects(() => listInventoryTaxProfiles(new URLSearchParams({ companyId: profileId }), context, { listTaxProfiles: () => assert.fail("Cross-company list reached persistence") }));
  let received;
  const created = await createInventoryTaxProfile(body, context, { createTaxProfile: async (input) => { received = input; return { kind: "saved", profile: { id: profileId }, replayed: false }; } });
  assert.equal(created.profile.id, profileId);
  assert.equal(received.companyId, companyId);
  assert.match(received.requestHash, /^[0-9a-f]{64}$/);
});

test("profile schemas reject unsupported currency and rates above 100 before persistence", async () => {
  const createTaxProfile = () => assert.fail("Invalid profile reached persistence");
  await assert.rejects(() => createInventoryTaxProfile({ ...body, currency: "ZZZ" }, context, { createTaxProfile }));
  await assert.rejects(() => createInventoryTaxProfile({ ...body, components: [{ name: "Bad tax", rate: "100.0001", compound: false }] }, context, { createTaxProfile }));
});

test("profile revisions and archive commands resolve company through tenant scope and map stale conflicts", async () => {
  const resolve = async (id, companyIds) => { assert.equal(id, profileId); assert.deepEqual(companyIds, [companyId]); return companyId; };
  const revised = await reviseInventoryTaxProfile(profileId, { name: body.name, currency: body.currency, jurisdiction: body.jurisdiction, components: body.components, reason: body.reason, idempotencyKey: body.idempotencyKey, expectedVersion: 1 }, context, {
    findTaxProfileCompany: resolve,
    reviseTaxProfile: async (input) => ({ kind: "saved", profile: { id: input.profileId, currentVersion: 2 }, replayed: false }),
  });
  assert.equal(revised.profile.currentVersion, 2);
  await assert.rejects(() => setInventoryTaxProfileArchived(profileId, { expectedVersion: 2, archived: true, reason: "No longer used", idempotencyKey: "archive-request-1" }, context, { findTaxProfileCompany: resolve, archiveTaxProfile: async () => ({ kind: "stale" }) }), (error) => error.code === "INVENTORY_TAX_PROFILE_STALE");
});
