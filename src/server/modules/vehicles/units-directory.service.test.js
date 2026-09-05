import assert from "node:assert/strict";
import test from "node:test";
import { readUnitsDirectory } from "./units-directory.service.js";
import { decodeUnitsDirectoryCursor, encodeUnitsDirectoryCursor, listUnitsDirectory } from "../../db/repositories/units-directory.repo.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
function context(role = "office", locations = [locationId]) {
  return { actor: { id: "actor-1", role }, companyIds: new Set([companyId]), locationIds: new Set(locations) };
}

test("directory uses company scope and office location scope", async () => {
  let received;
  await readUnitsDirectory(context(), { q: "T-1", type: "Truck", limit: "30" }, {
    list: async (input) => (received = input, { items: [], nextCursor: null }),
  });
  assert.deepEqual(received, { companyIds: [companyId], locationIds: [locationId], isAdmin: false, q: "T-1", unitType: "Truck", limit: 30, cursor: null });
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
  assert.deepEqual(received.values.slice(0, 4), [[companyId], false, [locationId], null]);
  assert.deepEqual(response.items, [{ id: first.id, companyId, locationId, custodyLocationId: locationId, unitNo: "TRK-1", unitType: "Truck", name: "Truck 1", vin: null, licensePlate: null, make: null, model: null, year: null }]);
  assert.ok(response.nextCursor);
});

test("directory derives custody location from the latest active serialized installation", async () => {
  let sql = "";
  await listUnitsDirectory({ companyIds: [companyId], locationIds: [], isAdmin: true, q: "G2020", unitType: null, limit: 25, cursor: null }, {
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
  assert.equal(values[6], "");
  assert.equal(values[7], "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
});

test("directory cursor decoder rejects non-base64url and unexpected cursor fields", () => {
  assert.throws(() => decodeUnitsDirectoryCursor("bad+encoding"), (error) => error.code === "INVALID_UNITS_DIRECTORY_CURSOR");
  const extraField = Buffer.from(JSON.stringify({ sortKey: "A", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", extra: true }), "utf8").toString("base64url");
  assert.throws(() => decodeUnitsDirectoryCursor(extraField), (error) => error.code === "INVALID_UNITS_DIRECTORY_CURSOR");
});
