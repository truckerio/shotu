import test from "node:test";
import assert from "node:assert/strict";
import { assertImportTarget, buildImportPlan, parseCsv } from "../../../../scripts/inventory/import-chino-manager-inventory.js";
import { canonicalChinoCoordinate } from "../../../../scripts/inventory/repair-chino-position-hierarchy.js";

const headers = "Part #,Part Name,Category,Fits / Description,Bin / Shelf,Opening Qty,Total In,Total Used,Current Qty,Reorder At,Status,Avg Cost,Sell Price,Inventory Value";

test("manager CSV parser handles quoted commas and escaped quotes", () => {
  assert.deepEqual(parseCsv('a,"b,c","d""e"\r\n'), [["a", "b,c", 'd"e']]);
});

test("manager inventory plan aggregates repeated part and position rows", () => {
  const plan = buildImportPlan(`Parts Inventory\n\n${headers}\nP-1,"Oil, filter",Filters,,A1-B2-S3,2,,,2,,,,,\nP-1,Oil filter,Filters,,A1-B2-S3,3,,,3,,,,,\nP-1,Oil filter,Filters,,A1-B2-S4,1,,,1,,,,,\n`, "manager.csv");
  assert.equal(plan.parts.length, 1);
  assert.equal(plan.parts[0].totalQuantity, 6);
  assert.deepEqual(plan.placements.map(({ positionKey, quantity }) => ({ positionKey, quantity })), [{ positionKey: "A1-B2-S3", quantity: 5 }, { positionKey: "A1-B2-S4", quantity: 1 }]);
});

test("manager coordinates map to aisle, shelf, then bin", () => {
  assert.deepEqual(canonicalChinoCoordinate("A1-B2-S3"), {
    aisleCode: "A1",
    shelfCode: "A1-S3",
    binCode: "A1-S3-B2",
    shelfName: "Shelf 3",
    binName: "Bin 2",
  });
  assert.equal(canonicalChinoCoordinate("SHOP-1"), null);
});

test("manager inventory plan preserves rows without supplied part numbers", () => {
  const plan = buildImportPlan(`Parts Inventory\n${headers}\n,Oil Drain Valve,Valves,,A4-B2-S4,21,,,21,,,,,\n,,,,A16-B1-S5,3,,,3,,,,,\n`, "manager.csv");
  assert.equal(plan.parts.length, 2);
  assert.match(plan.parts[0].partNumber, /^LOCAL-OILDRAINVALVE-/);
  assert.match(plan.parts[1].partNumber, /^UNIDENTIFIED-A16B1S5-/);
  assert.equal(plan.generatedPartNumbers.length, 2);
});

test("manager inventory plan rejects unknown location syntax", () => {
  assert.throws(() => buildImportPlan(`Parts Inventory\n${headers}\nP1,Part,,,Back wall,1,,,1,,,,,\n`), /Unsupported location/);
});

test("manager inventory import target permits localhost and rejects remote databases by default", () => {
  assert.deepEqual(assertImportTarget({ env: { DATABASE_URL: "postgresql://localhost:5433/workorder_generator", NODE_ENV: "development" } }), { target: "local", databaseHost: "localhost" });
  assert.throws(() => assertImportTarget({ env: { DATABASE_URL: "postgresql://postgres.railway.internal/app" } }), /only runs against a localhost database/);
});

test("manager inventory staging target requires the exact Railway staging identity and confirmation", () => {
  const env = {
    DATABASE_URL: "postgresql://postgres.railway.internal/app",
    RAILWAY_ENVIRONMENT_NAME: "staging",
    RAILWAY_PROJECT_NAME: "junior",
    RAILWAY_SERVICE_NAME: "junior",
    RAILWAY_PUBLIC_DOMAIN: "junior-staging.up.railway.app",
  };
  assert.throws(() => assertImportTarget({ target: "staging", env }), /requires --confirm-staging/);
  assert.deepEqual(assertImportTarget({ target: "staging", stagingConfirmation: "junior-staging.up.railway.app", env }), {
    target: "staging",
    databaseHost: "postgres.railway.internal",
    publicDomain: "junior-staging.up.railway.app",
  });
  assert.throws(() => assertImportTarget({ target: "staging", stagingConfirmation: "junior-staging.up.railway.app", env: { ...env, RAILWAY_ENVIRONMENT_NAME: "production" } }), /does not match the expected Railway/);
});
