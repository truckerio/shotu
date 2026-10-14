import assert from "node:assert/strict";
import test from "node:test";
import { classifyUnitTag } from "./unit-tag-classification.js";

test("operator-confirmed company families tolerate case, spacing and legal suffixes", () => {
  for (const name of ["SPG Transportation Inc", "spgtransportation", "SPG", "Protech", "Protec INC", "4s", "4S Transport", "4S Insurance"]) {
    assert.equal(classifyUnitTag(name), "company", name);
  }
});

test("additional business names are recognized while operational and unknown tags stay ordinary tags", () => {
  for (const name of ["AHA Freight", "AK Translinex", "ATS Cargo", "KSK Cargo INC", "Naaz Transport", "Regional Transport LLC"]) {
    assert.equal(classifyUnitTag(name), "company", name);
  }
  for (const name of ["Fleet", "Fleet Trailers", "Bluetooth", "Safety A", "Team Trucks", "Cargo Monitoring Pilot", "Deactivated Trucks", "Unrecognized label", "", null]) {
    assert.equal(classifyUnitTag(name), "other", String(name));
  }
});

test("route tags retain their own classification", () => {
  for (const name of ["CA Local", "CA Local/Regional", "regional", "Long Haul", "long-haul"]) assert.equal(classifyUnitTag(name), "route", name);
});
