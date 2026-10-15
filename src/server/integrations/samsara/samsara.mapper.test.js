import assert from "node:assert/strict";
import test from "node:test";
import { mapSamsaraTrailer, mapSamsaraVehicle, normalizeSamsaraTagNames } from "./samsara.mapper.js";

test("Samsara truck tags remain visible without guessing a company from tag order or a parenthetical name", () => {
  const truck = mapSamsaraVehicle({
    id: "truck-1",
    name: "Truck 1 (Legacy Carrier)",
    tags: [{ name: " CA Local " }, { name: "SPG" }, { name: "Long Haul" }],
  });

  assert.deepEqual(truck.tagNames, ["CA Local", "SPG", "Long Haul"]);
  assert.equal(truck.ownerName, null);
});

test("Samsara explicit external company takes precedence while trailer tags are preserved", () => {
  const trailer = mapSamsaraTrailer({
    id: "trailer-1",
    name: "Trailer 1 (Do Not Guess)",
    externalIds: { companyName: "Protech" },
    tags: [{ name: "Long Haul" }, { name: "SPG" }, { name: "Protech" }],
  });

  assert.equal(trailer.ownerName, "Protech");
  assert.deepEqual(trailer.tagNames, ["Long Haul", "SPG", "Protech"]);
});

test("Samsara team labels remain tags and invalid owner values do not suppress a later company name", () => {
  const truck = mapSamsaraVehicle({
    id: "truck-2",
    externalIds: { owner: { unsafe: true }, companyName: " Protech ", teamName: "CA Local" },
    tags: [{ name: "CA Local" }, { name: "Protech" }],
  });
  assert.equal(truck.ownerName, "Protech");
  assert.deepEqual(truck.tagNames, ["CA Local", "Protech"]);
});

test("Samsara owner projection accepts only bounded text", () => {
  assert.equal(mapSamsaraVehicle({ id: "truck-3", externalIds: { company: { unsafe: true } } }).ownerName, null);
  assert.equal(mapSamsaraVehicle({ id: "truck-4", externalIds: { company: `  ${"P".repeat(350)}  ` } }).ownerName.length, 300);
});

test("Samsara tag normalization trims, deduplicates case-insensitively, and bounds storage", () => {
  const overlong = "x".repeat(140);
  const tags = [
    { name: " SPG " },
    { name: "spg" },
    { name: "" },
    {},
    { name: { unsafe: true } },
    { name: overlong },
    ...Array.from({ length: 30 }, (_, index) => ({ name: `Tag ${index}` })),
  ];

  const tagNames = normalizeSamsaraTagNames(tags);
  assert.equal(tagNames[0], "SPG");
  assert.equal(tagNames[1].length, 120);
  assert.equal(tagNames.length, 25);
  assert.equal(tagNames.filter((name) => name.toLowerCase() === "spg").length, 1);
});

test("Samsara serialNumber is preserved for trucks and trailers", () => {
  const truck = mapSamsaraVehicle({ id: "truck-assets-1", serialNumber: "TRUCK-SERIAL" });
  const trailer = mapSamsaraTrailer({ id: "trailer-assets-1", serialNumber: "TRAILER-SERIAL" });

  assert.equal(truck.serial, "TRUCK-SERIAL");
  assert.equal(trailer.serial, "TRAILER-SERIAL");
});

test("Samsara mileage retains the odometer-specific time and OBD provenance", () => {
  const truck = mapSamsaraVehicle({ id: "truck-5" }, new Map([["truck-5", {
    obdOdometerMeters: [{ value: 160934.4, time: "2026-10-14T10:00:00.000Z" }],
    gpsOdometerMeters: [{ value: 162000, time: "2026-10-14T11:00:00.000Z" }],
  }]]));
  assert.equal(truck.lastOdometerMiles, 100000 / 1000);
  assert.equal(truck.odometerSource, "samsara_obd");
  assert.equal(truck.odometerObservedAt, "2026-10-14T10:00:00.000Z");
});

test("Samsara mileage falls back to GPS without using vehicle sync time", () => {
  const truck = mapSamsaraVehicle({ id: "truck-6", updatedAtTime: "2026-10-14T12:00:00.000Z" }, new Map([["truck-6", {
    gpsOdometerMeters: { value: 1609.344, time: "2026-10-14T09:00:00.000Z" },
  }]]));
  assert.equal(truck.lastOdometerMiles, 1);
  assert.equal(truck.odometerSource, "samsara_gps");
  assert.equal(truck.odometerObservedAt, "2026-10-14T09:00:00.000Z");
});

test("Samsara uses timestamped GPS mileage when an OBD value has no observation time", () => {
  const truck = mapSamsaraVehicle({ id: "truck-7" }, new Map([["truck-7", {
    obdOdometerMeters: { value: 3218.688 },
    gpsOdometerMeters: { value: 4828.032, time: "2026-10-14T09:00:00.000Z" },
  }]]));
  assert.equal(truck.lastOdometerMiles, 3);
  assert.equal(truck.odometerSource, "samsara_gps");
  assert.equal(truck.odometerObservedAt, "2026-10-14T09:00:00.000Z");
});
