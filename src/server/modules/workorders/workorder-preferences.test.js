import assert from "node:assert/strict";
import test from "node:test";
import { workorderPreferencesSchema } from "./workorder-preferences.schemas.js";

test("workorder preferences accept role-specific saved filters", () => {
  const result = workorderPreferencesSchema.parse({
    defaultLocationId: null,
    defaultView: "needs_attention",
    pageSize: 50,
    savedFilters: {
      admin: { category: "needs_attention", sort: "timeInStatus:desc" },
      mechanic: { activeTab: "myWork" },
    },
  });
  assert.equal(result.defaultView, "needs_attention");
  assert.equal(result.savedFilters.mechanic.activeTab, "myWork");
});

test("workorder preferences enforce bounded page size", () => {
  assert.throws(() => workorderPreferencesSchema.parse({ pageSize: 500 }));
});
