import assert from "node:assert/strict";
import test from "node:test";
import { createLocalVehicle, createManualVehicleSchema, normalizedVehicleIdentity } from "./manual-vehicle.service.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const input = { companyId, locationId, unitType: "Trailer", unitNo: "TRL- 44", vin: "1AB C", licensePlate: "CA-44" };
const context = (role = "office", locations = [locationId]) => ({ actor: { id: "actor-1", role }, companyIds: new Set([companyId]), companyRoles: new Map([[companyId, role]]), locationIds: new Set(locations) });
const location = { id: locationId, company_id: companyId, active: true };

test("manual local unit requires stable unit identity and Truck or Trailer", () => {
  assert.equal(createManualVehicleSchema.safeParse({ ...input, unitNo: "" }).success, false);
  assert.equal(createManualVehicleSchema.safeParse({ ...input, unitType: "Other" }).success, false);
  assert.equal(normalizedVehicleIdentity(" TRL- 44 "), "trl44");
});

test("office creates a scoped canonical local asset after normalized duplicate scan", async () => {
  let duplicatesInput; let created;
  const vehicle = await createLocalVehicle(context(), input, {
    readLocation: async () => location,
    findDuplicates: async (value) => (duplicatesInput = value, []),
    create: async (value) => (created = value, { id: "asset-1", company_id: companyId, location_id: locationId, unit_type: value.unitType, unit_no: value.unitNo }),
  });
  assert.deepEqual(duplicatesInput, { companyId, unitNo: "trl44", vin: "1abc", licensePlate: "ca44" });
  assert.equal(created.unitType, "Trailer");
  assert.equal(vehicle.id, "asset-1");
});

test("duplicate identity fails closed until Office explicitly confirms it", async () => {
  const dependencies = { readLocation: async () => location, findDuplicates: async () => [{ id: "existing" }], create: async () => ({ id: "asset-2" }) };
  await assert.rejects(createLocalVehicle(context(), input, dependencies), (error) => error.statusCode === 409 && error.code === "MANUAL_VEHICLE_DUPLICATE_CONFIRMATION_REQUIRED");
  assert.equal((await createLocalVehicle(context(), { ...input, confirmDuplicate: true }, dependencies)).id, "asset-2");
});

test("mechanics and cross-location Office requests cannot create local units", async () => {
  const dependencies = { readLocation: async () => location, findDuplicates: async () => [], create: async () => assert.fail("must not create") };
  await assert.rejects(createLocalVehicle(context("mechanic"), input, dependencies), (error) => error.statusCode === 403);
  await assert.rejects(createLocalVehicle(context("office", []), input, dependencies), (error) => error.statusCode === 404);
  await assert.rejects(createLocalVehicle(context("office"), { ...input, companyId: "33333333-3333-4333-8333-333333333333" }, dependencies), (error) => error.statusCode === 404);
});
