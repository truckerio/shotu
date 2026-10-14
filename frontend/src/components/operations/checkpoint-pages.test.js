import assert from "node:assert/strict";
import test from "node:test";
import { createCheckpointPagesController } from "./checkpoint-pages.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("catalog identities deduplicate by company and preserve scoped tab metadata", async () => {
  const controller = createCheckpointPagesController({
    getItemKey: (item) => `${item.companyId}:${item.catalogPartId}`,
    fetchPage: async (page) => ({ page, pageCount: 2, total: 3,
      meta: { counts: { all: 3 } },
      items: page === 1 ? [{companyId:"a",catalogPartId:"p"}] : [{companyId:"a",catalogPartId:"p"},{companyId:"b",catalogPartId:"p"}],
    }),
  });
  await controller.start();
  await controller.loadNext();
  assert.equal(controller.getSnapshot().pages.flatMap(batch => batch.items).length, 2);
  assert.deepEqual(controller.getSnapshot().pages[1].meta, {counts:{all:3}});
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function response(page, ids, { pageCount = 12, total = 240 } = {}) {
  return { page, pageCount, total, items: ids.map((id) => ({ id, label: id })) };
}

test("empty results are terminal and do not prefetch nonexistent batches", async () => {
  const calls = [];
  const controller = createCheckpointPagesController({
    fetchPage: async (page) => {
      calls.push(page);
      return response(1, [], { pageCount: 0, total: 0 });
    },
  });
  await controller.start();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(await controller.loadNext(), false);
    assert.equal(await controller.loadPrevious(), false);
  }
  assert.deepEqual(calls, [1]);
  assert.equal(controller.getSnapshot().loadingMore, false);
  assert.equal(controller.getSnapshot().loading, false);
});

test("loads a bounded contiguous window and trims the opposite edge", async () => {
  const controller = createCheckpointPagesController({
    fetchPage: async (page) => response(page, [`${page}-a`]),
    initialPage: 3,
    maxPages: 3,
  });
  await controller.start();
  await controller.loadNext();
  await controller.loadNext();
  await controller.loadNext();
  assert.deepEqual(controller.getSnapshot().pages.map(({ page }) => page), [4, 5, 6]);
  await controller.loadPrevious();
  assert.deepEqual(controller.getSnapshot().pages.map(({ page }) => page), [3, 4, 5]);
});

test("distant jumps fetch only the target and reuse a valid cached page", async () => {
  const calls = [];
  const controller = createCheckpointPagesController({
    fetchPage: async (page) => {
      calls.push(page);
      return response(page, [`${page}-a`]);
    },
  });
  await controller.start();
  await controller.jumpTo(8);
  await controller.jumpTo(1);
  assert.deepEqual(calls, [1, 8]);
  assert.deepEqual(controller.getSnapshot().pages.map(({ page }) => page), [1]);
  assert.equal(controller.getSnapshot().jumpRevision, 2);
});

test("bounds the reusable page cache to nine least-recently-used entries", async () => {
  const calls = [];
  const controller = createCheckpointPagesController({
    fetchPage: async (page) => {
      calls.push(page);
      return response(page, [`${page}-a`]);
    },
  });
  await controller.start();
  for (let page = 2; page <= 10; page += 1) await controller.jumpTo(page);
  await controller.jumpTo(1);
  assert.deepEqual(calls, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1]);
});

test("a jump aborts pending work and rejects its late response", async () => {
  const pendingNext = deferred();
  let nextSignal;
  const controller = createCheckpointPagesController({
    fetchPage: (page, { signal }) => {
      if (page === 2) {
        nextSignal = signal;
        return pendingNext.promise;
      }
      return Promise.resolve(response(page, [`${page}-a`]));
    },
  });
  await controller.start();
  const loadingNext = controller.loadNext();
  await tick();
  await controller.jumpTo(7);
  assert.equal(nextSignal.aborted, true);
  pendingNext.resolve(response(2, ["stale"]));
  await loadingNext;
  assert.deepEqual(controller.getSnapshot().pages, [{ page: 7, items: [{ id: "7-a", label: "7-a" }] }]);
});

test("deduplicates item IDs across visible pages", async () => {
  const controller = createCheckpointPagesController({
    fetchPage: async (page) => page === 1
      ? response(1, ["a", "shared"])
      : response(2, ["shared", "b"]),
  });
  await controller.start();
  await controller.loadNext();
  assert.deepEqual(
    controller.getSnapshot().pages.map(({ items }) => items.map(({ id }) => id)),
    [["a", "shared"], ["b"]],
  );
});

test("quiet refresh is atomic and preserves current server sort order", async () => {
  const refreshes = new Map();
  let refreshing = false;
  const controller = createCheckpointPagesController({
    fetchPage: (page) => {
      if (!refreshing) return Promise.resolve(response(page, page === 1 ? ["a", "b"] : ["c", "d"]));
      const request = deferred();
      refreshes.set(page, request);
      return request.promise;
    },
  });
  await controller.start();
  await controller.loadNext();
  refreshing = true;
  const refreshPromise = controller.refresh();
  await tick();
  refreshes.get(1).resolve({ ...response(1, ["new", "a"]), items: [{ id: "new" }, { id: "a", label: "updated" }] });
  await tick();
  assert.deepEqual(
    controller.getSnapshot().pages.flatMap(({ items }) => items.map(({ id }) => id)),
    ["a", "b", "c", "d"],
  );
  refreshes.get(2).resolve(response(2, ["b", "c"]));
  await refreshPromise;
  const items = controller.getSnapshot().pages.flatMap((page) => page.items);
  assert.deepEqual(items.map(({ id }) => id), ["new", "a", "b", "c"]);
  assert.equal(items[1].label, "updated");
});

test("recovers count metadata before clamping a checkpoint after results shrink", async () => {
  const calls = [];
  let shrunk = false;
  const controller = createCheckpointPagesController({
    fetchPage: async (page) => {
      calls.push(page);
      if (!shrunk) return response(page, [`${page}-old`]);
      if (page === 1) return response(1, ["first"], { pageCount: 3, total: 42 });
      if (page === 3) return response(3, ["last"], { pageCount: 3, total: 42 });
      return response(page, [], { pageCount: 0, total: 0 });
    },
  });
  await controller.start();
  shrunk = true;
  await controller.jumpTo(9);
  assert.deepEqual(calls, [1, 9, 1, 3]);
  assert.deepEqual(controller.getSnapshot().pages.map(({ page }) => page), [3]);
  assert.equal(controller.getSnapshot().total, 42);
  assert.equal(controller.getSnapshot().pageCount, 3);
});

test("refresh is single-flight, blocks edge loads, and invalidates pages outside the visible window", async () => {
  const calls = [];
  let pendingRefresh = null;
  const controller = createCheckpointPagesController({
    fetchPage: (page) => {
      calls.push(page);
      if (pendingRefresh && page === 8) return pendingRefresh.promise;
      return Promise.resolve(response(page, [`${page}-a`]));
    },
  });
  await controller.start();
  await controller.jumpTo(8);
  pendingRefresh = deferred();
  const refreshing = controller.refresh();
  assert.equal(controller.getSnapshot().loadingMore, true);
  assert.equal(await controller.refresh(), false);
  assert.equal(await controller.loadNext(), false);
  pendingRefresh.resolve(response(8, ["8-updated"]));
  assert.equal(await refreshing, true);
  assert.equal(controller.getSnapshot().loadingMore, false);
  await controller.jumpTo(1);
  assert.deepEqual(calls, [1, 8, 8, 1]);
});

test("keeps valid rows and exposes the failed direction for retry", async () => {
  let fail = true;
  const controller = createCheckpointPagesController({
    fetchPage: async (page) => {
      if (page === 2 && fail) throw new Error("offline");
      return response(page, [`${page}-a`]);
    },
  });
  await controller.start();
  assert.equal(await controller.loadNext(), false);
  assert.deepEqual(controller.getSnapshot().pages.map(({ page }) => page), [1]);
  assert.equal(controller.getSnapshot().failedDirection, "next");
  fail = false;
  assert.equal(await controller.retry(), true);
  assert.deepEqual(controller.getSnapshot().pages.map(({ page }) => page), [1, 2]);
});

test("stop treats generic errors from an aborted request as stale", async () => {
  const pending = deferred();
  const controller = createCheckpointPagesController({
    fetchPage: (_page, { signal }) => new Promise((resolve, reject) => {
      pending.promise.then(resolve, reject);
      signal.addEventListener("abort", () => reject(new Error("request failed")), { once: true });
    }),
  });
  const loading = controller.start();
  await tick();
  controller.stop();
  assert.equal(await loading, false);
});
