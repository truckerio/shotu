import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyProductModuleMap,
  modeAllows,
  normalizeProductModuleMode,
  productModuleCompatibilityDefault,
  resolveProductModuleMode,
} from "./product-modules.js";

test("compatibility defaults preserve workorders and keep inspections off", () => {
  assert.deepEqual(emptyProductModuleMap(), { workorders: "full", inspections: "off" });
  assert.equal(productModuleCompatibilityDefault("inspections", "admin"), "full");
  assert.equal(productModuleCompatibilityDefault("inspections", "office"), "full");
  assert.equal(productModuleCompatibilityDefault("inspections", "mechanic"), "full");
  assert.equal(productModuleCompatibilityDefault("inspections", "surveillance"), "read");
  assert.equal(normalizeProductModuleMode("READ"), "read");
  assert.equal(normalizeProductModuleMode("invalid"), "off");
});

test("product access uses user then role and location then company precedence", () => {
  const input = {
    moduleKey: "inspections", role: "office", userId: "user-1",
    companyRules: [
      { moduleKey: "inspections", subjectType: "role", subjectId: "office", mode: "read", version: 2 },
      { moduleKey: "inspections", subjectType: "user", subjectId: "user-1", mode: "off", version: 3 },
    ],
    locationRules: [
      { moduleKey: "inspections", subjectType: "role", subjectId: "office", mode: "full", version: 4 },
      { moduleKey: "inspections", subjectType: "user", subjectId: "user-1", mode: "read", version: 5 },
    ],
  };
  assert.deepEqual(resolveProductModuleMode(input), { mode: "read", source: "location_user", version: 5 });
  assert.equal(resolveProductModuleMode({ ...input, locationRules: [] }).source, "company_user");
  assert.equal(resolveProductModuleMode({ ...input, companyRules: input.companyRules.slice(0, 1), locationRules: input.locationRules.slice(0, 1) }).source, "location_role");
});

test("read and full capabilities remain distinct", () => {
  assert.equal(modeAllows("read", "read"), true);
  assert.equal(modeAllows("read", "write"), false);
  assert.equal(modeAllows("full", "write"), true);
  assert.equal(modeAllows("off", "read"), false);
});
