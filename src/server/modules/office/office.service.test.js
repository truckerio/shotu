import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { officeDashboard } from "./office.service.js";

test("Office Parts mutations retain an explicit active Office or Admin owner guard", async () => {
  const source = await readFile(new URL("./office.service.js", import.meta.url), "utf8");
  const guard = source.slice(source.indexOf("async function requireOffice"), source.indexOf("export async function defaultOfficeUser"));

  assert.match(guard, /user\.active/);
  assert.match(guard, /\["office", "admin"\]\.includes\(user\.role\)/);
});

test("Office work done explicitly permits empty diagnosis and repair details", async () => {
  const source = await readFile(new URL("./office.service.js", import.meta.url), "utf8");
  const operation = source.slice(source.indexOf("export async function markOfficeWorkorderDone"), source.indexOf("export async function officeWorkorderDetail"));

  assert.match(operation, /requireAssignedMechanic:\s*false/);
  assert.match(operation, /requireRepairDetails:\s*false/);
});

test("office dashboard includes assigned mechanics without workorders", async () => {
  const queries = [];
  const locationIds = new Set([
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
  ]);
  const mechanics = [
    { id: "mechanic-1", name: "Mechanic One", locationIds: [...locationIds] },
    { id: "mechanic-2", name: "Mechanic Two", locationIds: [...locationIds] },
  ];
  const companyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  const dashboard = await officeDashboard(
    { actor: { id: "office-1", role: "office" }, companyIds: new Set([companyId]),
      companyRoles: new Map([[companyId, "office"]]), locationIds },
    {
      queryWorkorders: async (_context, input) => {
        queries.push(input);
        return { items: [], total: 0 };
      },
      listMechanics: async (authorizedLocationIds) => {
        assert.deepEqual(authorizedLocationIds, [...locationIds]);
        return mechanics;
      },
      listLocations: async ({ locationIds: ids }) => ids.map((locationId) => ({ locationId })),
    },
  );

  assert.deepEqual(dashboard.mechanics, mechanics);
  assert.deepEqual(dashboard.counts, {
    open: 0,
    active: 0,
    parts: 0,
    done: 0,
    closed: 0,
  });
  assert.deepEqual(queries.map(({ category }) => category), ["unassigned", "all", "parts", "ready_review", "all"]);
  assert.deepEqual(queries[1].lifecycle, ["accepted", "in_progress"]);
});

test("office dashboard excludes mechanic-only company workorders and locations", async () => {
  const companyA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const companyB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const locationA = "11111111-1111-4111-8111-111111111111";
  const locationB = "22222222-2222-4222-8222-222222222222";
  const scopes = [];
  let mechanicLocations;
  await officeDashboard({
    actor: { id: "actor-1", role: "admin" },
    companyIds: new Set([companyA, companyB]),
    companyRoles: new Map([[companyA, "office"], [companyB, "mechanic"]]),
    locationIds: new Set([locationA, locationB]),
  }, {
    queryWorkorders: async (context) => { scopes.push([...context.companyIds]); return { items: [], total: 0 }; },
    listLocations: async ({ companyIds }) => companyIds.includes(companyA) ? [{ locationId: locationA }] : [],
    listMechanics: async (ids) => { mechanicLocations = ids; return []; },
  });
  assert.deepEqual(scopes, Array(5).fill([companyA]));
  assert.deepEqual(mechanicLocations, [locationA]);
});
