import assert from "node:assert/strict";
import test from "node:test";
import { productModuleCapabilities, productModuleMode } from "./product-module-access.js";

const actor = { productModuleAccess: { companies: [{ companyId: "c", modules: { workorders: "full", inspections: "off" }, locations: [{ locationId: "l", modules: { workorders: "off", inspections: "read" } }, { locationId: "l2", modules: { workorders: "full", inspections: "full" } }] }] } };

test("product access resolves exact location and strongest available workspace mode", () => {
  assert.equal(productModuleMode(actor, "inspections", "l"), "read");
  assert.equal(productModuleMode(actor, "inspections"), "full");
  assert.deepEqual(productModuleCapabilities(actor, "workorders", "l"), { mode: "off", canRead: false, canWrite: false });
});

test("missing bootstrap access fails closed", () => {
  assert.equal(productModuleMode({}, "inspections"), "off");
});
