import assert from "node:assert/strict";
import test from "node:test";
import { startStockAutoRefresh, STOCK_REFRESH_INTERVAL_MS } from "./stock-auto-refresh.js";

function target() {
  const listeners = new Map();
  return { listeners,
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    async fire(name) { await Promise.all([...(listeners.get(name) || [])].map((fn) => fn())); },
  };
}
function fixture(refresh = async () => {}, noStream = false) {
  const documentTarget = { ...target(), visibilityState: "visible" };
  const stream = { ...target(), close() { this.closed = true; } };
  const windowTarget = { ...target(), navigator: { onLine: true },
    setInterval(fn, ms) { this.timer = { fn, ms }; return 7; },
    clearInterval() { this.timer = null; },
    setTimeout(fn, ms) { this.deferred = { fn, ms }; return 8; },
    clearTimeout() { this.deferred = null; },
  };
  let time = 0, allowed = false, calls = 0;
  const signals = [];
  const stop = startStockAutoRefresh({ documentTarget, windowTarget, now: () => time,
    createEventSource: () => { if (noStream) throw new Error("unavailable"); return stream; },
    canRefresh: () => allowed,
    refresh: async ({ signal }) => { calls += 1; signals.push(signal); await refresh(); },
  });
  return { documentTarget, windowTarget, stream, signals, stop,
    get calls() { return calls; }, allow(value = true) { allowed = value; },
    advance(ms = STOCK_REFRESH_INTERVAL_MS) { time += ms; },
    async tick() { time += STOCK_REFRESH_INTERVAL_MS; await windowTarget.timer?.fn(); },
    async deferred() { const task = windowTarget.deferred; windowTarget.deferred = null; time += task.ms; await task.fn(); },
  };
}

test("healthy stream refreshes on ready and change, without interval reads", async () => {
  const f = fixture(); f.allow();
  await f.stream.fire("ready"); assert.equal(f.calls, 1);
  await f.tick(); assert.equal(f.calls, 1);
  await f.stream.fire("inventory-change"); assert.equal(f.calls, 2);
  await f.tick(); assert.equal(f.calls, 2); f.stop();
});

test("part, intake and count gates retain events and flush once after closing", async () => {
  const f = fixture(); await f.stream.fire("ready");
  for (let editor = 0; editor < 3; editor += 1) {
    f.allow(false);
    await f.stream.fire("inventory-change"); await f.stream.fire("inventory-change");
    await f.tick(); assert.equal(f.calls, editor);
    f.allow(); await f.stop.check(); assert.equal(f.calls, editor + 1);
  }
  f.stop();
});

test("hidden/offline events queue until visible and online", async () => {
  const f = fixture(); f.allow(); f.documentTarget.visibilityState = "hidden";
  await f.stream.fire("ready"); await f.tick(); assert.equal(f.calls, 0);
  f.documentTarget.visibilityState = "visible"; f.windowTarget.navigator.onLine = false;
  await f.documentTarget.fire("visibilitychange"); assert.equal(f.calls, 0);
  f.windowTarget.navigator.onLine = true; await f.windowTarget.fire("online"); assert.equal(f.calls, 1);
  await f.windowTarget.fire("focus"); assert.equal(f.calls, 1); f.stop();
});

test("disconnection enables recovery polling; ready resyncs and stops polling", async () => {
  const f = fixture(); f.allow(); await f.stream.fire("ready");
  await f.stream.fire("error"); await f.tick(); assert.equal(f.calls, 2);
  f.advance(); await f.stream.fire("ready"); assert.equal(f.calls, 3);
  await f.tick(); assert.equal(f.calls, 3); f.stop();
  const fallback = fixture(undefined, true); fallback.allow();
  await fallback.tick(); await fallback.tick(); assert.equal(fallback.calls, 2); fallback.stop();
});

test("events during a read coalesce into one follow-up without overlapping", async () => {
  let release;
  const f = fixture(() => new Promise((resolve) => { release = resolve; })); f.allow();
  const first = f.stream.fire("ready"); assert.equal(f.calls, 1);
  await f.stream.fire("inventory-change"); await f.stream.fire("inventory-change");
  assert.equal(f.calls, 1); release(); await first;
  assert.equal(f.windowTarget.deferred.ms, 1000);
  await f.deferred(); assert.equal(f.calls, 2);
  release(); f.stop();
});

test("cleanup aborts reads, closes stream and removes timer/listeners", async () => {
  let release;
  const f = fixture(() => new Promise((resolve) => { release = resolve; })); f.allow();
  const pending = f.stream.fire("ready"); f.stop();
  assert.equal(f.signals[0].aborted, true); assert.equal(f.stream.closed, true);
  assert.equal(f.windowTarget.timer, null);
  assert.equal([...f.windowTarget.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
  assert.equal([...f.documentTarget.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
  release(); await pending; await f.stream.fire("inventory-change"); assert.equal(f.calls, 1);
});

test("read errors stay with owner Retry and suspend subsequent automatic reads", async () => {
  const f = fixture(async () => { f.allow(false); throw new Error("failed"); }); f.allow();
  await f.stream.fire("ready"); await f.stream.fire("inventory-change");
  await f.tick(); assert.equal(f.calls, 1);
  f.stop();
});


test("a queue that becomes busy before React renders retains the invalidation", async () => {
  const documentTarget = { ...target(), visibilityState: "visible" };
  const stream = { ...target(), close() {} };
  let time = 0, calls = 0, deferred;
  const windowTarget = { ...target(), navigator: { onLine: true },
    setInterval() { return 1; }, clearInterval() {},
    setTimeout(fn, ms) { deferred = { fn, ms }; return 2; }, clearTimeout() {},
  };
  const stop = startStockAutoRefresh({ documentTarget, windowTarget, now: () => time,
    createEventSource: () => stream, canRefresh: () => true,
    refresh: async () => { calls++; return calls > 1; },
  });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls, 1); assert.equal(deferred.ms, 1000);
  time = 1000; await deferred.fn();
  assert.equal(calls, 2, "busy queue is retried rather than losing the event");
  stop();
});
