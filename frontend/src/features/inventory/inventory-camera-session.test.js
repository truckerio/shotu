import assert from "node:assert/strict";
import test from "node:test";
import { createInventoryCameraSession } from "./inventory-camera-session.js";

test("camera session permits one pending start and invalidates it when cancelled", () => {
  const session = createInventoryCameraSession();
  const firstStart = session.begin();

  assert.equal(typeof firstStart, "number");
  assert.equal(session.begin(), null);
  assert.equal(session.isCurrent(firstStart), true);

  session.cancel();

  assert.equal(session.isCurrent(firstStart), false);
  const nextStart = session.begin();
  assert.equal(typeof nextStart, "number");
  assert.notEqual(nextStart, firstStart);
  assert.equal(session.isCurrent(nextStart), true);
});

test("a stale completion cannot release a newer pending camera start", () => {
  const session = createInventoryCameraSession();
  const firstStart = session.begin();
  session.cancel();
  const secondStart = session.begin();

  session.finish(firstStart);

  assert.equal(session.begin(), null);
  session.finish(secondStart);
  assert.equal(typeof session.begin(), "number");
});

test("a late stream is stopped after cancellation", () => {
  const session = createInventoryCameraSession();
  const token = session.begin();
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };

  session.cancel();

  assert.equal(session.stopIfStale(token, stream), true);
  assert.equal(track.stopped, true);
});
