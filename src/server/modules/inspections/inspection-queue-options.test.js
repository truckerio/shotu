import assert from "node:assert/strict";
import test from "node:test";
import { inspectionQueueOptions } from "./inspection.service.js";

const context = { actor: { id: "me", name: "Mechanic" }, companyIds: new Set(["a", "b"]), locationIds: new Set(["a1", "b1"]), companyRoles: new Map([["a", "admin"], ["b", "mechanic"]]) };
const bootstrap = async () => ({ companies: [{ companyId: "a", locations: [{ locationId: "a1", modules: { inspections: "read" } }, { locationId: "off", modules: { inspections: "off" } }] }, { companyId: "b", locations: [{ locationId: "b1", modules: { inspections: "full" } }] }] });

test("queue options use readable locations and company-effective mechanic visibility", async () => {
  const calls = [];
  const options = await inspectionQueueOptions(context, {
    bootstrap,
    listLocations: async scope => { calls.push(scope); return scope.companyIds[0] === "a" ? [{ companyId: "a", locationId: "a1", name: "A yard" }, { companyId: "a", locationId: "off", name: "Hidden" }] : [{ companyId: "b", locationId: "b1", name: "B yard" }]; },
    listMechanics: async locationId => { assert.equal(locationId, "a1"); return [{ id: "other", name: "Other", role: "mechanic", active: true, membership_active: true }, { id: "inactive", role: "mechanic", active: false, membership_active: true }]; },
  });
  assert.deepEqual(options.locations.map(location => location.id), ["a1", "b1"]);
  assert.deepEqual(options.mechanics.map(mechanic => mechanic.id).sort(), ["me", "other"]);
  assert.deepEqual(options.mechanics.find(mechanic => mechanic.id === "me").locationIds, ["b1"]);
  assert.equal(calls[0].locationIds, null);
  assert.deepEqual(calls[1].locationIds, ["a1", "b1"]);
});

test("queue options require authentication and never list mechanics for read-only surveillance", async () => {
  await assert.rejects(inspectionQueueOptions({}), error => error.statusCode === 401);
  const options = await inspectionQueueOptions({ ...context, companyIds: new Set(["a"]), companyRoles: new Map([["a", "surveillance"]]) }, { bootstrap, listLocations: async () => [{ companyId: "a", locationId: "a1", name: "A yard" }], listMechanics: async () => assert.fail("Must not broaden read-only identity access") });
  assert.deepEqual(options.mechanics, []);
});
