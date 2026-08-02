import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMechanicHomeView,
  mechanicJobActionLabel,
  selectNextMechanicJob,
} from "./mechanic-workspace-model.js";

test("selectNextMechanicJob chooses active work deterministically", () => {
  const jobs = [
    { id: "accepted-old", lifecycle: "accepted", createdAt: "2026-07-01T10:00:00Z" },
    { id: "progress-new", lifecycle: "in_progress", createdAt: "2026-07-03T10:00:00Z" },
    { id: "progress-old-b", lifecycle: "in_progress", createdAt: "2026-07-02T10:00:00Z" },
    { id: "progress-old-a", lifecycle: "in_progress", createdAt: "2026-07-02T10:00:00Z" },
  ];

  assert.equal(selectNextMechanicJob(jobs).id, "progress-old-a");
  assert.equal(selectNextMechanicJob([...jobs].reverse()).id, "progress-old-a");
});

test("mechanic next-job action matches lifecycle", () => {
  assert.equal(mechanicJobActionLabel({ lifecycle: "accepted" }), "Start job");
  assert.equal(mechanicJobActionLabel({ lifecycle: "in_progress" }), "Continue job");
  assert.equal(mechanicJobActionLabel({ status: "waiting_office" }), "Continue job");
});

test("mechanic home separates next, assigned, and available work", () => {
  const dashboard = {
    myWork: [
      { id: "accepted", lifecycle: "accepted", createdAt: "2026-07-01T10:00:00Z" },
      { id: "progress", lifecycle: "in_progress", createdAt: "2026-07-02T10:00:00Z" },
    ],
    openWork: [{ id: "available", lifecycle: "open" }],
    waiting: [{ id: "waiting" }],
    done: [{ id: "done" }],
  };

  const view = buildMechanicHomeView(dashboard);
  assert.equal(view.nextJob.id, "progress");
  assert.deepEqual(view.assignedJobs.map(({ id }) => id), ["accepted"]);
  assert.deepEqual(view.availableJobs.map(({ id }) => id), ["available"]);
  assert.deepEqual(view.waitingJobs.map(({ id }) => id), ["waiting"]);
  assert.deepEqual(view.historyJobs.map(({ id }) => id), ["done"]);
});

test("mechanic home does not render an empty next-job card", () => {
  const view = buildMechanicHomeView({ myWork: [], openWork: [{ id: "available" }] });
  assert.equal(view.nextJob, null);
  assert.deepEqual(view.assignedJobs, []);
  assert.deepEqual(view.availableJobs.map(({ id }) => id), ["available"]);
});

test("mechanic home accepts the initial null dashboard while loading", () => {
  assert.deepEqual(buildMechanicHomeView(null), {
    nextJob: null,
    assignedJobs: [],
    availableJobs: [],
    waitingJobs: [],
    historyJobs: [],
  });
});
