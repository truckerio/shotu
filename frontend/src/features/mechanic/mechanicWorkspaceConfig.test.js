import assert from "node:assert/strict";
import test from "node:test";
import {
  MECHANIC_PRIMARY_TABS,
  MECHANIC_SECONDARY_TABS,
  mechanicActionLabel,
} from "./mechanicWorkspaceConfig.js";

test("mechanic queues keep assigned and available as primary buckets", () => {
  assert.deepEqual(MECHANIC_PRIMARY_TABS.map(({ key, label }) => ({ key, label })), [
    { key: "myWork", label: "My work" },
    { key: "openWork", label: "Available" },
  ]);
  assert.deepEqual(MECHANIC_SECONDARY_TABS.map(({ key, label }) => ({ key, label })), [
    { key: "waiting", label: "Waiting" },
    { key: "done", label: "History" },
    { key: "activeWork", label: "All active" },
  ]);
});

test("mechanic queue action language matches next task", () => {
  assert.equal(mechanicActionLabel("myWork"), "Open");
  assert.equal(mechanicActionLabel("openWork"), "Accept");
  assert.equal(mechanicActionLabel("activeWork"), "Join");
  assert.equal(mechanicActionLabel("done"), "Open");
});
