import assert from "node:assert/strict";
import test from "node:test";
import {
  APPLICATION_OWNED_INVENTORY_PROVIDERS,
  isApplicationOwnedInventoryProvider,
} from "./inventory-provider.js";

test("application-owned inventory provider policy is explicit and fail-closed", () => {
  assert.deepEqual(APPLICATION_OWNED_INVENTORY_PROVIDERS, ["local", "local_count", "local_serialization"]);
  for (const provider of APPLICATION_OWNED_INVENTORY_PROVIDERS) {
    assert.equal(isApplicationOwnedInventoryProvider(provider), true);
  }
  assert.equal(isApplicationOwnedInventoryProvider("odoo"), false);
  assert.equal(isApplicationOwnedInventoryProvider(""), false);
  assert.equal(isApplicationOwnedInventoryProvider(null), false);
});
