import assert from "node:assert/strict";
import test from "node:test";
import { inspectionRefreshMode, loadInspectionRefreshWindow, MAX_LIVE_INSPECTION_ROWS, mergeFastInspectionPage } from "./inspection-api-model.js";

test("fast refresh publishes new rows without dropping cursor-boundary rows", () => {
  assert.deepEqual(
    mergeFastInspectionPage([{ id: "a" }, { id: "b" }, { id: "c" }], [{ id: "new" }, { id: "a" }]),
    [{ id: "new" }, { id: "a" }, { id: "b" }, { id: "c" }],
  );
});

test("background refresh refetches the loaded window when a new row shifts cursor boundaries", async () => {
  const pages = new Map([
    ["", { items: [{ id: "new" }, { id: "a" }], nextCursor: "after-a" }],
    ["after-a", { items: [{ id: "b" }, { id: "c" }], nextCursor: "after-c" }],
  ]);
  assert.deepEqual(
    await loadInspectionRefreshWindow(({ cursor }) => Promise.resolve(pages.get(cursor)), { loadedCount: 4, pageSize: 2 }),
    { items: [{ id: "new" }, { id: "a" }, { id: "b" }, { id: "c" }], nextCursor: "after-c" },
  );
});

test("background refresh removes a later-page row that no longer matches the server filter", async () => {
  const pages = new Map([
    ["", { items: [{ id: "a" }, { id: "b" }], nextCursor: "after-b" }],
    ["after-b", { items: [{ id: "d" }], nextCursor: "" }],
  ]);
  assert.deepEqual(
    await loadInspectionRefreshWindow(({ cursor }) => Promise.resolve(pages.get(cursor)), { loadedCount: 4, pageSize: 2 }),
    { items: [{ id: "a" }, { id: "b" }, { id: "d" }], nextCursor: "" },
  );
});

test("ten-minute live API request budget stays bounded across loaded window sizes", () => {
  const cycles = 600_000 / 3_000;
  for (const loadedCount of [25, 50, MAX_LIVE_INSPECTION_ROWS]) {
    let requests = 0;
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      requests += inspectionRefreshMode(cycle) === "reconcile" ? Math.ceil(loadedCount / 50) : 1;
    }
    assert.ok(requests <= 240, `${loadedCount} loaded rows scheduled ${requests} requests`);
  }
});
