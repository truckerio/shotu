import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATIC_REFRESH_INTERVAL_MS,
  createAutomaticRefreshController,
  createLatestRequestGuard,
  LIVE_QUEUE_REFRESH_INTERVAL_MS,
} from "./useAutomaticRefresh.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function fakeBrowser() {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const intervals = new Map();
  let nextInterval = 1;
  let time = 0;
  const windowObject = {
    addEventListener: (name, listener) => windowListeners.set(name, listener),
    removeEventListener: (name, listener) => {
      if (windowListeners.get(name) === listener) windowListeners.delete(name);
    },
    setInterval: (listener, intervalMs) => {
      const id = nextInterval++;
      intervals.set(id, { intervalMs, listener });
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
  };
  const documentObject = {
    visibilityState: "visible",
    addEventListener: (name, listener) => documentListeners.set(name, listener),
    removeEventListener: (name, listener) => {
      if (documentListeners.get(name) === listener) documentListeners.delete(name);
    },
  };
  return {
    advance: (milliseconds) => { time += milliseconds; },
    documentListeners,
    documentObject,
    intervals,
    now: () => time,
    random: () => 0,
    tick: () => [...intervals.values()].forEach(({ listener }) => listener()),
    windowListeners,
    windowObject,
  };
}

test("short live cadence is explicit while unrelated automatic refresh stays conservative", () => {
  assert.equal(AUTOMATIC_REFRESH_INTERVAL_MS, 30_000);
  assert.equal(LIVE_QUEUE_REFRESH_INTERVAL_MS, 3_000);
});

test("a live timer refresh publishes the returned queue snapshot without a reload event", async () => {
  const browser = fakeBrowser();
  let visibleItems = [];
  const serverItems = [{ id: "inspection-created-by-admin" }];
  const controller = createAutomaticRefreshController(async () => {
    visibleItems = [...serverItems];
  }, { ...browser, intervalMs: LIVE_QUEUE_REFRESH_INTERVAL_MS });

  browser.tick();
  await Promise.resolve();
  assert.deepEqual(visibleItems, serverItems);
  controller.stop();
});

test("latest-request guard rejects a late response from an older filter generation", () => {
  const guard = createLatestRequestGuard();
  const oldRequest = guard.begin();
  const currentRequest = guard.begin();
  assert.equal(guard.isCurrent(oldRequest), false);
  assert.equal(guard.isCurrent(currentRequest), true);
});

test("refresh controller is single-flight across timer, focus, and visibility triggers", async () => {
  const browser = fakeBrowser();
  const pending = deferred();
  let calls = 0;
  const controller = createAutomaticRefreshController(() => {
    calls += 1;
    return pending.promise;
  }, browser);

  browser.tick();
  browser.tick();
  browser.windowListeners.get("focus")();
  browser.documentListeners.get("visibilitychange")();
  assert.equal(calls, 1);

  pending.resolve();
  await pending.promise;
  await Promise.resolve();
  browser.tick();
  assert.equal(calls, 2);
  controller.stop();
});

test("hidden tabs pause polling and become current immediately when visible", async () => {
  const browser = fakeBrowser();
  let calls = 0;
  const controller = createAutomaticRefreshController(async () => { calls += 1; }, browser);

  browser.documentObject.visibilityState = "hidden";
  browser.tick();
  browser.windowListeners.get("focus")();
  assert.equal(calls, 0);

  browser.documentObject.visibilityState = "visible";
  browser.documentListeners.get("visibilitychange")();
  await Promise.resolve();
  assert.equal(calls, 1);
  controller.stop();
});

test("transient failures recover on the next interval without stopping polling", async () => {
  const browser = fakeBrowser();
  let calls = 0;
  const controller = createAutomaticRefreshController(async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary");
  }, browser);

  browser.tick();
  await Promise.resolve();
  await Promise.resolve();
  browser.tick();
  await Promise.resolve();
  assert.equal(calls, 1);
  browser.advance(AUTOMATIC_REFRESH_INTERVAL_MS * 2);
  browser.tick();
  await Promise.resolve();
  assert.equal(calls, 2);
  controller.stop();
});

test("cleanup removes timers and event listeners", () => {
  const browser = fakeBrowser();
  let calls = 0;
  const controller = createAutomaticRefreshController(async () => { calls += 1; }, browser);
  controller.stop();
  controller.stop();

  browser.tick();
  assert.equal(browser.intervals.size, 0);
  assert.equal(browser.windowListeners.size, 0);
  assert.equal(browser.documentListeners.size, 0);
  assert.equal(calls, 0);
});

test("cleanup aborts an in-flight refresh and suppresses post-stop success", async () => {
  const browser = fakeBrowser();
  const pending = deferred();
  let signal;
  const controller = createAutomaticRefreshController(async (context) => {
    signal = context.signal;
    await pending.promise;
  }, browser);

  browser.tick();
  assert.equal(signal.aborted, false);
  controller.stop();
  assert.equal(signal.aborted, true);
  pending.resolve();
  await pending.promise;
  await Promise.resolve();
  assert.equal(await controller.refresh(), false);
});

test("ten-minute timer stress remains bounded and never overlaps", async () => {
  const browser = fakeBrowser();
  const pending = deferred();
  let calls = 0;
  const controller = createAutomaticRefreshController(() => {
    calls += 1;
    return pending.promise;
  }, { ...browser, intervalMs: LIVE_QUEUE_REFRESH_INTERVAL_MS });

  const tenMinutesOfTicks = 600_000 / LIVE_QUEUE_REFRESH_INTERVAL_MS;
  for (let index = 0; index < tenMinutesOfTicks; index += 1) browser.tick();
  assert.equal(tenMinutesOfTicks, 200);
  assert.equal(calls, 1);

  pending.reject(new Error("stress complete"));
  await pending.promise.catch(() => {});
  await Promise.resolve();
  controller.stop();
});

test("ten minutes of completed live cycles stays within the 200-request budget", async () => {
  const browser = fakeBrowser();
  let calls = 0;
  const controller = createAutomaticRefreshController(async () => { calls += 1; }, {
    ...browser,
    intervalMs: LIVE_QUEUE_REFRESH_INTERVAL_MS,
  });

  for (let elapsed = 0; elapsed < 600_000; elapsed += LIVE_QUEUE_REFRESH_INTERVAL_MS) {
    browser.advance(LIVE_QUEUE_REFRESH_INTERVAL_MS);
    await controller.refresh();
  }
  assert.equal(calls, 200);
  controller.stop();
});

test("ten minutes of continuous failures backs off to a bounded outage request budget", async () => {
  const browser = fakeBrowser();
  let calls = 0;
  const controller = createAutomaticRefreshController(async () => {
    calls += 1;
    throw new Error("offline");
  }, { ...browser, intervalMs: LIVE_QUEUE_REFRESH_INTERVAL_MS });

  for (let elapsed = 0; elapsed < 600_000; elapsed += LIVE_QUEUE_REFRESH_INTERVAL_MS) {
    browser.advance(LIVE_QUEUE_REFRESH_INTERVAL_MS);
    await controller.refresh();
  }
  assert.ok(calls <= 22, `expected no more than 22 failed requests, received ${calls}`);
  controller.stop();
});
