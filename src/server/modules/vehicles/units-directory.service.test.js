import assert from "node:assert/strict";
import test from "node:test";
import { readUnitsDirectory, readUnitsDirectoryFacets } from "./units-directory.service.js";
import { decodeUnitsDirectoryCursor, encodeUnitsDirectoryCursor, listUnitsDirectory, listUnitsDirectoryFacets } from "../../db/repositories/units-directory.repo.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const otherCompanyId = "33333333-3333-4333-8333-333333333333";
const locationId = "22222222-2222-4222-8222-222222222222";
function context(role = "office", locations = [locationId]) {
  return { actor: { id: "actor-1", role }, companyIds: new Set([companyId]), locationIds: new Set(locations) };
}

test("directory uses company scope and office location scope", async () => {
  let received;
  await readUnitsDirectory(context(), { q: "T-1", type: "Truck", limit: "30" }, {
    list: async (input) => (received = input, { items: [], nextCursor: null }),
  });
  assert.deepEqual(received, { companyIds: [companyId], adminCompanyIds: [], locationIds: [locationId], q: "T-1", unitType: "Truck", companyTag: "", routeTag: "", repair: "all", sort: "unit_asc", limit: 30, cursor: null });
});

test("mixed admin and office memberships retain per-company location rules", async () => {
  const mixed = {
    actor: { id: "actor-1", role: "admin" },
    companyIds: new Set([companyId, otherCompanyId]),
    companyRoles: new Map([[companyId, "admin"], [otherCompanyId, "office"]]),
    locationIds: new Set([locationId]),
  };
  let scope;
  await readUnitsDirectory(mixed, {}, { list: async (input) => (scope = input, { items: [], nextCursor: null }) });
  assert.deepEqual(scope.companyIds, [companyId, otherCompanyId]);
  assert.deepEqual(scope.adminCompanyIds, [companyId]);
  assert.deepEqual(scope.locationIds, [locationId]);
  const missingRole = { ...mixed, companyRoles: new Map([[companyId, "mechanic"], [otherCompanyId, "office"]]) };
  await readUnitsDirectory(missingRole, {}, { list: async (input) => (scope = input, { items: [], nextCursor: null }) });
  assert.deepEqual(scope.companyIds, [otherCompanyId]);
  assert.deepEqual(scope.adminCompanyIds, []);
});

test("directory maps Other to the same authorized repository scope", async () => {
  let received;
  await readUnitsDirectory(context(), { type: "Other" }, {
    list: async (input) => (received = input, { items: [], nextCursor: null }),
  });
  assert.deepEqual(received, { companyIds: [companyId], adminCompanyIds: [], locationIds: [locationId], q: "", unitType: "Other", companyTag: "", routeTag: "", repair: "all", sort: "unit_asc", limit: 25, cursor: null });
});

test("directory passes exact page mode through the existing actor scope", async () => {
  let received;
  await readUnitsDirectory(context(), { type: "Trailer", limit: "20", page: "3" }, {
    list: async (input) => (received = input, { items: [], total: 0, page: 3, pageCount: 0, nextCursor: null }),
  });
  assert.deepEqual(received, { companyIds: [companyId], adminCompanyIds: [], locationIds: [locationId], q: "", unitType: "Trailer", companyTag: "", routeTag: "", repair: "all", sort: "unit_asc", limit: 20, cursor: null, page: 3 });
});

test("directory forwards exact Samsara tags, repair state, and sort without changing actor scope", async () => {
  let received;
  await readUnitsDirectory(context(), { type: "Truck", companyTag: "SPG Transportation Inc", routeTag: "CA Local/Regional", repair: "under_repair", sort: "repair_first" }, {
    list: async (input) => (received = input, { items: [], nextCursor: null }),
  });
  assert.equal(received.companyTag, "SPG Transportation Inc");
  assert.equal(received.routeTag, "CA Local/Regional");
  assert.equal(received.repair, "under_repair");
  assert.equal(received.sort, "repair_first");
  assert.deepEqual(received.companyIds, [companyId]);
  assert.deepEqual(received.locationIds, [locationId]);
});

test("directory rejects ambiguous cursor and exact page requests", async () => {
  await assert.rejects(
    readUnitsDirectory(context(), { cursor: "cursor", page: "2" }, { list: async () => assert.fail("must not query") }),
    (error) => error.statusCode === 400 && error.code === "INVALID_UNITS_DIRECTORY_QUERY",
  );
});

test("directory rejects non-office roles before repository access", async () => {
  await assert.rejects(
    readUnitsDirectory(context("mechanic"), {}, { list: async () => assert.fail("must not query") }),
    (error) => error.statusCode === 403,
  );
});

test("directory bounds query input", async () => {
  const invalidQuery = (error) => error.statusCode === 400 && error.code === "INVALID_UNITS_DIRECTORY_QUERY";
  await assert.rejects(readUnitsDirectory(context(), { q: "x".repeat(121) }), invalidQuery);
  await assert.rejects(readUnitsDirectory(context(), { cursor: "x".repeat(1001) }), invalidQuery);
  await assert.rejects(readUnitsDirectory(context(), { companyTag: "x".repeat(121) }), invalidQuery);
  await assert.rejects(readUnitsDirectory(context(), { repair: "broken" }), invalidQuery);
  await assert.rejects(readUnitsDirectory(context(), { sort: "provider_payload" }), invalidQuery);
});

test("directory filter facets preserve actor scope and reject unauthorized roles", async () => {
  let received;
  const result = await readUnitsDirectoryFacets(context(), { type: "Truck" }, {
    listFacets: async (input) => (received = input, { companyTags: [], routeTags: [] }),
  });
  assert.deepEqual(result, { companyTags: [], routeTags: [] });
  assert.deepEqual(received, { companyIds: [companyId], adminCompanyIds: [], locationIds: [locationId], unitType: "Truck" });
  await assert.rejects(
    readUnitsDirectoryFacets(context("mechanic"), {}, { listFacets: async () => assert.fail("must not query") }),
    (error) => error.statusCode === 403,
  );
});

test("directory rejects an invalid cursor before querying", async () => {
  await assert.rejects(
    listUnitsDirectory({ companyIds: [companyId], locationIds: [locationId], isAdmin: false, q: "", unitType: null, limit: 25, cursor: "not-a-cursor" }, {
      query: async () => assert.fail("must not query"),
    }),
    (error) => error.statusCode === 400 && error.code === "INVALID_UNITS_DIRECTORY_CURSOR",
  );
});

test("directory keeps office rows location-scoped and returns a keyset next cursor", async () => {
  let received;
  const first = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", companyId, locationId, custodyLocationId: locationId, unitNo: "TRK-1", unitType: "Truck", name: "Truck 1", vin: null, licensePlate: null, make: null, model: null, year: null, sortKey: "TRK-1" };
  const second = { ...first, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", unitNo: "TRK-2", sortKey: "TRK-2" };
  const response = await listUnitsDirectory({ companyIds: [companyId], locationIds: [locationId], isAdmin: false, q: "", unitType: null, limit: 1, cursor: null }, {
    query: async (text, values) => (received = { text, values }, { rows: [first, second] }),
  });
  assert.match(received.text, /a\.location_id = any\(\$3::uuid\[\]\)/);
  assert.deepEqual(received.values.slice(0, 4), [[companyId], [], [locationId], null]);
  assert.deepEqual(response.items, [{ id: first.id, companyId, locationId, custodyLocationId: locationId, unitNo: "TRK-1", unitType: "Truck", name: "Truck 1", vin: null, licensePlate: null, make: null, model: null, year: null }]);
  assert.ok(response.nextCursor);
});

test("directory SQL grants company-wide rows only to the matching Admin company", async () => {
  let captured;
  await listUnitsDirectory({
    companyIds: [companyId, otherCompanyId],
    adminCompanyIds: [companyId],
    locationIds: [locationId],
    q: "", unitType: null, limit: 25, cursor: null,
  }, { query: async (sql, values) => (captured = { sql, values }, { rows: [] }) });
  assert.match(captured.sql, /a\.company_id = any\(\$2::uuid\[\]\) or a\.location_id = any\(\$3::uuid\[\]\)/);
  assert.deepEqual(captured.values.slice(0, 3), [[companyId, otherCompanyId], [companyId], [locationId]]);
});

test("exact pages return filtered totals and deterministic offsets", async () => {
  let received;
  const row = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", companyId, locationId, custodyLocationId: locationId, unitNo: "TRK-26", unitType: "Truck", name: "Truck 26", vin: null, licensePlate: null, make: null, model: null, year: null, sortKey: "TRK-26", __total: 51 };
  const response = await listUnitsDirectory({ companyIds: [companyId], locationIds: [locationId], isAdmin: false, q: "TRK", unitType: "Truck", limit: 25, cursor: null, page: 2 }, {
    query: async (text, values) => (received = { text, values }, { rows: [row] }),
  });
  assert.match(received.text, /select count\(\*\)::int as "__total" from filtered/);
  assert.match(received.text, /order by "sortKey" asc, id asc limit \$10 offset \$11/i);
  assert.deepEqual(received.values.slice(-2), [25, 25]);
  assert.deepEqual(response, { items: [{ id: row.id, companyId, locationId, custodyLocationId: locationId, unitNo: "TRK-26", unitType: "Truck", name: "Truck 26", vin: null, licensePlate: null, make: null, model: null, year: null }], total: 51, page: 2, pageCount: 3, nextCursor: null });
});

test("an exact page beyond the result set still returns the filtered total", async () => {
  const response = await listUnitsDirectory({ companyIds: [companyId], locationIds: [locationId], isAdmin: false, q: "TRK", unitType: "Truck", limit: 25, cursor: null, page: 9 }, {
    query: async () => ({ rows: [{ id: null, sortKey: null, __total: 51 }] }),
  });
  assert.deepEqual(response, { items: [], total: 51, page: 9, pageCount: 3, nextCursor: null });
});

test("directory exposes bounded tags and same-company active repair metadata", async () => {
  let received;
  const row = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", companyId, locationId, custodyLocationId: locationId,
    unitNo: "TRK-1", unitType: "Truck", name: "Truck 1", vin: null, licensePlate: null, make: null, model: null, year: null,
    tagNames: ["SPG Transportation Inc", "Long Haul"], activeWorkorder: { id: "workorder-1", serial: "WO-0001", status: "in_progress" },
    sortKey: "0|TRK-1", __total: 1,
  };
  const response = await listUnitsDirectory({ companyIds: [companyId], locationIds: [locationId], isAdmin: false, q: "", unitType: "Truck", companyTag: "SPG Transportation Inc", routeTag: "Long Haul", repair: "under_repair", sort: "repair_first", limit: 25, cursor: null, page: 1 }, {
    query: async (text, values) => (received = { text, values }, { rows: [row] }),
  });
  assert.match(received.text, /workorder\.company_id = a\.company_id/);
  assert.match(received.text, /workorder\.status not in \('closed', 'odoo_entered', 'cancelled'\)/);
  assert.match(received.text, /a\.tag_names \? \$7/);
  assert.match(received.text, /a\.tag_names \? \$8/);
  assert.deepEqual(received.values.slice(6, 9), ["SPG Transportation Inc", "Long Haul", "under_repair"]);
  assert.deepEqual(response.items[0].tagNames, ["SPG Transportation Inc", "Long Haul"]);
  assert.equal(response.items[0].activeWorkorder.serial, "WO-0001");
});

test("tag facets split provider route labels without inventing company hierarchy", async () => {
  const response = await listUnitsDirectoryFacets({ companyIds: [companyId], locationIds: [locationId], isAdmin: false, unitType: "Truck" }, {
    query: async (text, values) => {
      assert.match(text, /jsonb_array_elements_text\(a\.tag_names\)/);
      assert.deepEqual(values, [[companyId], [], [locationId], "Truck"]);
      return { rows: [
        { name: "CA Local", count: 2 },
        { name: "CA Local/Regional", count: 43 },
        { name: "Long Haul", count: 109 },
        { name: "SPG Transportation Inc", count: 173 },
        { name: "Protec INC", count: 57 },
        { name: "4S Transport", count: 59 },
        { name: "Fleet", count: 100 },
        { name: "Safety A", count: 10 },
      ] };
    },
  });
  assert.deepEqual(response.routeTags.map((tag) => tag.name), ["CA Local", "CA Local/Regional", "Long Haul"]);
  assert.deepEqual(response.companyTags, [{ name: "SPG Transportation Inc", count: 173 }, { name: "Protec INC", count: 57 }, { name: "4S Transport", count: 59 }]);
});

test("Other category includes future equipment types but excludes trucks and trailers", async () => {
  let received;
  await listUnitsDirectory({ companyIds: [companyId], locationIds: [locationId], isAdmin: false, q: "", unitType: "Other", limit: 25, cursor: null }, {
    query: async (text, values) => (received = { text, values }, { rows: [] }),
  });
  assert.match(received.text, /\$4 = 'Other' and coalesce\(a\.unit_type, ''\) not in \('Truck', 'Trailer'\)/);
  assert.equal(received.values[3], "Other");
});

test("directory derives custody location from the latest active serialized installation", async () => {
  let sql = "";
  await listUnitsDirectory({ companyIds: [companyId], adminCompanyIds: [companyId], locationIds: [], q: "G2020", unitType: null, limit: 25, cursor: null }, {
    query: async (text) => { sql = text; return { rows: [] }; },
  });
  assert.match(sql, /usage\.asset_id = a\.id/);
  assert.match(sql, /usage\.status in \('installed_pending_approval', 'installed', 'removed'\)/);
  assert.match(sql, /case when usage\.status in \('installed_pending_approval', 'installed'\) then 0 else 1 end/);
  assert.match(sql, /limit 1\s*\),\s*a\.location_id\s*\) as "custodyLocationId"/);
});

test("directory LIKE query escapes backslash before wildcard characters", async () => {
  let values;
  await listUnitsDirectory({ companyIds: [companyId], locationIds: [locationId], isAdmin: false, q: "\\%_", unitType: null, limit: 1, cursor: null }, {
    query: async (_text, receivedValues) => (values = receivedValues, { rows: [] }),
  });
  assert.equal(values[5], "%\\\\\\%\\_%");
});

test("directory preserves an empty cursor sort key for unlabeled rows", async () => {
  let values;
  const cursor = encodeUnitsDirectoryCursor({ sortKey: "", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  await listUnitsDirectory({ companyIds: [companyId], locationIds: [locationId], isAdmin: false, q: "", unitType: null, limit: 1, cursor }, {
    query: async (_text, receivedValues) => (values = receivedValues, { rows: [] }),
  });
  assert.equal(values[9], "");
  assert.equal(values[10], "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
});

test("directory cursor decoder rejects non-base64url and unexpected cursor fields", () => {
  assert.throws(() => decodeUnitsDirectoryCursor("bad+encoding"), (error) => error.code === "INVALID_UNITS_DIRECTORY_CURSOR");
  const extraField = Buffer.from(JSON.stringify({ sortKey: "A", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", extra: true }), "utf8").toString("base64url");
  assert.throws(() => decodeUnitsDirectoryCursor(extraField), (error) => error.code === "INVALID_UNITS_DIRECTORY_CURSOR");
});
