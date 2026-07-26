import assert from "node:assert/strict";
import test from "node:test";
import { createMapVisibilityController } from "./map-visibility-controller.js";

function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    schedule(callback, delay) {
      const id = nextId++;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    advance(milliseconds) {
      const end = now + milliseconds;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
    },
    pending() {
      return timers.size;
    },
  };
}

function createHarness() {
  const clock = createClock();
  const events = [];
  const controller = createMapVisibilityController({
    onMount: () => events.push("mount"),
    onExpand: () => events.push("expand"),
    onCollapse: () => events.push("collapse"),
    onUnmount: () => events.push("unmount"),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  return { clock, controller, events };
}

test("map uses a 250ms open delay", () => {
  const { clock, controller, events } = createHarness();
  controller.open();
  clock.advance(249);
  assert.deepEqual(events, []);
  clock.advance(1);
  assert.deepEqual(events, ["mount", "expand"]);
});

test("map uses a 250ms close delay and stays mounted through its transition", () => {
  const { clock, controller, events } = createHarness();
  controller.open({ immediate: true });
  controller.close();
  clock.advance(249);
  assert.deepEqual(events, ["mount", "expand"]);
  clock.advance(1);
  assert.deepEqual(events, ["mount", "expand", "collapse"]);
  clock.advance(249);
  assert.deepEqual(events, ["mount", "expand", "collapse"]);
  clock.advance(1);
  assert.deepEqual(events, ["mount", "expand", "collapse", "unmount"]);
});

test("pointer re-entry cancels pending close and reopens an animating map", () => {
  const pending = createHarness();
  pending.controller.open({ immediate: true });
  pending.controller.close();
  pending.clock.advance(200);
  pending.controller.cancelClose();
  pending.clock.advance(400);
  assert.deepEqual(pending.events, ["mount", "expand"]);

  const animating = createHarness();
  animating.controller.open({ immediate: true });
  animating.controller.close({ immediate: true });
  animating.clock.advance(100);
  animating.controller.open({ immediate: true });
  animating.clock.advance(400);
  assert.deepEqual(animating.events, ["mount", "expand", "collapse", "mount", "expand"]);
});

test("outside-click close is immediate but still retains content for animation", () => {
  const { clock, controller, events } = createHarness();
  controller.open({ immediate: true });
  controller.close({ immediate: true });
  assert.deepEqual(events, ["mount", "expand", "collapse"]);
  clock.advance(250);
  assert.deepEqual(events, ["mount", "expand", "collapse", "unmount"]);
});

test("dispose cancels every pending map timer", () => {
  const { clock, controller, events } = createHarness();
  controller.open();
  controller.close();
  controller.dispose();
  clock.advance(1_000);
  assert.deepEqual(events, []);
  assert.equal(clock.pending(), 0);
});
