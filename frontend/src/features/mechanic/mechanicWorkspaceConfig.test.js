import assert from "node:assert/strict";
import test from "node:test";
import {
  MECHANIC_PRIMARY_TABS,
  MECHANIC_SECONDARY_TABS,
  mechanicActionLabel,
} from "./mechanicWorkspaceConfig.js";

test("phone mechanic queues expose three primary buckets", () => {
  assert.deepEqual(MECHANIC_PRIMARY_TABS.map(({ key, label }) => ({ key, label })), [
    { key: "myWork", label: "My work" },
    { key: "openWork", label: "Available" },
    { key: "done", label: "Done" },
  ]);
  assert.deepEqual(MECHANIC_SECONDARY_TABS.map(({ key }) => key), ["waiting", "activeWork"]);
});

test("mechanic queue action language matches next task", () => {
  assert.equal(mechanicActionLabel("myWork"), "Finish / open");
  assert.equal(mechanicActionLabel("openWork"), "Accept");
  assert.equal(mechanicActionLabel("activeWork"), "Join");
  assert.equal(mechanicActionLabel("done"), "Open");
});
