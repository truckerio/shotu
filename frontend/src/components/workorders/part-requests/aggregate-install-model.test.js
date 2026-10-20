import assert from "node:assert/strict";
import test from "node:test";
import { canInstallQuantityUsage } from "./aggregate-install-model.js";

test("only editable reserved quantity stock offers installation", () => {
  assert.equal(canInstallQuantityUsage({ trackingMode: "quantity", status: "reserved" }, true), true);
  for (const trackingMode of ["measured_bulk", "no_stock", undefined]) {
    assert.equal(canInstallQuantityUsage({ trackingMode, status: "reserved" }, true), false);
  }
  for (const status of ["installed_pending_approval", "consumed", "released", "reversed"]) {
    assert.equal(canInstallQuantityUsage({ trackingMode: "quantity", status }, true), false);
  }
  assert.equal(canInstallQuantityUsage({ trackingMode: "quantity", status: "reserved" }, false), false);
});
