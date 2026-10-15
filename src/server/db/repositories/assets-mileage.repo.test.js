import assert from "node:assert/strict";
import test from "node:test";
import { upsertVehicles } from "./assets.repo.js";
import { recordProviderAssetMileage } from "./asset-mileage.repo.js";

const companyId = "11111111-1111-4111-8111-111111111111";
for (const reading of [
  { lastOdometerMiles: -100, odometerObservedAt: new Date().toISOString() },
  { lastOdometerMiles: 11_000_000, odometerObservedAt: new Date().toISOString() },
  { lastOdometerMiles: 100, odometerObservedAt: "2100-01-01T00:00:00.000Z" },
  { lastOdometerMiles: 100, odometerObservedAt: null },
]) {
  test(`new asset cannot publish rejected provider mileage: ${JSON.stringify(reading)}`, async () => {
    let inserts = 0;
    await upsertVehicles([{ provider: "samsara", providerVehicleId: "vehicle-1", unitType: "Truck", odometerSource: "samsara_obd", lastOdometerMeters: -100, ...reading }], companyId, {
      query: async (_sql, values) => {
        inserts++;
        assert.equal(values[16], null);
        assert.equal(values[17], null);
        return { rows: [{ id: "asset-1" }], rowCount: 1 };
      },
      recordMileage: input => recordProviderAssetMileage(input, { pool: { connect: async () => assert.fail("invalid evidence must not open transaction") } }),
    });
    assert.equal(inserts, 1);
  });
}

test("new identity is created before validated mileage evidence owns compatibility update", async () => {
  const order = [];
  await upsertVehicles([{ provider: "samsara", providerVehicleId: "vehicle-1", unitType: "Truck", lastOdometerMiles: 100, odometerObservedAt: "2026-10-14T12:00:00Z", odometerSource: "samsara_obd" }], companyId, {
    query: async (_sql, values) => { order.push("identity"); assert.equal(values[17], null); return { rows: [{ id: "asset-1" }], rowCount: 1 }; },
    recordMileage: async input => { order.push("evidence"); assert.equal(input.miles, 100); assert.equal(input.assetId, "asset-1"); assert.equal(input.companyId, companyId); },
  });
  assert.deepEqual(order, ["identity", "evidence"]);
});
