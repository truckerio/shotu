import assert from "node:assert/strict";
import test from "node:test";
import {
  MECHANIC_QUEUE_TABS,
  mechanicActionLabel,
  mechanicQueueTabsForViewport,
} from "./mechanicWorkspaceConfig.js";

test("wide mechanic navigation exposes every queue from one ordered config", () => {
  assert.deepEqual(MECHANIC_QUEUE_TABS.map(({ key, label }) => ({ key, label })), [
    { key: "myWork", label: "My work" },
    { key: "openWork", label: "Available" },
    { key: "waiting", label: "Waiting" },
    { key: "done", label: "History" },
    { key: "activeWork", label: "All active" },
  ]);

  const wide = mechanicQueueTabsForViewport(false);
  assert.deepEqual(wide.primary.map(({ key }) => key), ["myWork", "openWork", "waiting", "done", "activeWork"]);
  assert.deepEqual(wide.secondary, []);
});

test("phone navigation keeps important queues visible and discloses secondary queues", () => {
  const phone = mechanicQueueTabsForViewport(true);
  assert.deepEqual(phone.primary.map(({ key }) => key), ["myWork", "openWork", "waiting"]);
  assert.deepEqual(phone.secondary.map(({ key }) => key), ["done", "activeWork"]);
});

test("mechanic queue action language matches next task", () => {
  assert.equal(mechanicActionLabel("myWork"), "Open");
  assert.equal(mechanicActionLabel("openWork"), "Accept");
  assert.equal(mechanicActionLabel("activeWork"), "Join");
  assert.equal(mechanicActionLabel("done"), "Open");
});
