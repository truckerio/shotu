import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeVehicleLookupValue,
  splitSerial,
  uniqueExactVehicleMatch,
  vehicleLookupValues,
} from "./create-workorder-utils.js";

test("serial parser keeps prefix, number, and padding width", () => {
  assert.deepEqual(splitSerial("WO-000009"), { prefix: "WO-", nextNumber: 9, digits: 6 });
  assert.deepEqual(splitSerial("bad"), { prefix: "WO-", nextNumber: 1, digits: 6 });
});

test("vehicle lookup normalization supports exact unit/name matching", () => {
  assert.equal(normalizeVehicleLookupValue(" G-2001 "), "g2001");
  assert.deepEqual(
    vehicleLookupValues({ unit_no: "G-2001", unitNo: "G2001", name: "Truck G 2001" }),
    ["g2001", "g2001", "truckg2001"],
  );
});

test("unique exact vehicle match rejects partial and ambiguous matches", () => {
  const vehicles = [
    { id: "1", unit_no: "G2001", name: "Truck G2001" },
    { id: "2", unit_no: "G2002", name: "Truck G2002" },
  ];
  assert.equal(uniqueExactVehicleMatch(vehicles, "g2001")?.id, "1");
  assert.equal(uniqueExactVehicleMatch(vehicles, "g20"), null);
  assert.equal(uniqueExactVehicleMatch([...vehicles, { id: "3", unit_no: "G-2001" }], "g2001"), null);
});
