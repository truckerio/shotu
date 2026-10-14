import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createCheckpointExtent } from "./checkpoint-extent.js";

const batch = (page, height = 1600, rows = 20) => ({ page, height, rows });
test("extent respects each collection's page size and partial last batch", () => {
  const extent = createCheckpointExtent(25);
  extent.measure([batch(1, 1000, 25)], 3, 57, 1000);
  assert.equal(extent.offset(3), 2000);
  assert.deepEqual(extent.spacing(1,1), {before:0,after:1280});
  assert.equal(extent.pageAt(2100), 3);
});
test("trimming batches preserves full scrollbar extent instead of restarting the window", () => {
  const extent = createCheckpointExtent();
  extent.measure([batch(1), batch(2)], 36, 707, 1000);
  const initial = extent.spacing(1, 2);
  assert.deepEqual(initial, { before: 0, after: 53360 });
  extent.measure([3, 4, 5, 6, 7].map(page => batch(page)), 36, 707, 1000);
  const trimmed = extent.spacing(3, 7);
  assert.equal(trimmed.before, 3200);
  assert.equal(initial.before + 3200 + initial.after, trimmed.before + 8000 + trimmed.after);
  assert.equal(extent.pageAt(3200), 3);
  assert.equal(extent.pageAt(50000), 32);
  assert.equal(extent.pageAt(100000), 36);
});
test("measured heights survive eviction and partial last batches do not distort estimates", () => {
  const extent = createCheckpointExtent();
  extent.measure([batch(36, 560, 7)], 36, 707, 1000);
  assert.equal(extent.offset(36), 56000);
  extent.measure([batch(2, 1700)], 36, 707, 1000);
  assert.equal(extent.offset(3), 3300);
  assert.equal(extent.spacing(36, 36).after, 0);
  extent.measure([batch(1, 4000)], 36, 707, 400);
  assert.equal(extent.offset(3), 8000);
});
test("empty and single batch results have no phantom runway", () => {
  const extent = createCheckpointExtent();
  extent.measure([], 0, 0, 1000);
  assert.deepEqual(extent.spacing(1, 1), { before: 0, after: 0 });
  extent.measure([batch(1, 240, 3)], 1, 3, 1000);
  assert.deepEqual(extent.spacing(1, 1), { before: 0, after: 0 });
});

test("phone loading and recovery notices stay viewport-relative, not at the virtual document bottom", () => {
  const css = readFileSync(new URL("./checkpoint-queue-table.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.checkpoint-queue-notice \{ position: fixed; bottom: calc\(16px \+ env\(safe-area-inset-bottom\)\)/);
});
