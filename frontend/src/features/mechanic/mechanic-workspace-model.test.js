import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMechanicHomeView,
  mechanicJobActionLabel,
  mixedMechanicQueue,
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

test("mixed queue keeps assigned inspection and workorder work together with deterministic type-safe rows", () => {
  const queue = mixedMechanicQueue({ myWork: [{ id: "wo-1", serial: "WO-1", lifecycle: "accepted", createdAt: "2026-01-02" }], openWork: [], waiting: [], done: [] }, [
    { id: "in-1", number: "INS-1", status: "in_progress", unitNo: "T-1", requestedAt: "2026-01-01", templateLabel: "Weekly Truck Inspection" },
    { id: "in-2", number: "INS-2", status: "completed", unitNo: "T-2", completedAt: "2026-01-03" },
  ]);
  assert.deepEqual(queue.myWork.map((item) => [item.queueType, item.id]), [["inspection", "in-1"], ["workorder", "wo-1"]]);
  assert.deepEqual(queue.done.map((item) => item.id), ["in-2"]);
  assert.match(queue.myWork[0].serial, /^Inspection · INS-1$/);
});

test("mixed queue makes unassigned inspections available and keeps every open lifecycle active", () => {
  const queue = mixedMechanicQueue({}, [
    { id:"requested", number:"INS-1", status:"requested", unitNo:"1017", requestedAt:"2026-09-04" },
    { id:"assigned", number:"INS-2", status:"assigned", unitNo:"1018", requestedAt:"2026-09-04" },
    { id:"started", number:"INS-3", status:"in_progress", unitNo:"1019", startedAt:"2026-09-04" },
  ]);

  assert.deepEqual(queue.openWork.map(({ id }) => id), ["requested"]);
  assert.deepEqual(queue.myWork.map(({ id }) => id), ["started", "assigned"]);
  assert.deepEqual(new Set(queue.activeWork.map(({ id }) => id)), new Set(["requested", "assigned", "started"]));
  assert.deepEqual(queue.waiting, []);
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
