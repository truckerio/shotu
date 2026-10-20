import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const queueUrl = new URL("./WorkorderQueue.jsx", import.meta.url);
const detailUrl = new URL("../../features/workorder-detail/WorkorderActivityStatus.jsx", import.meta.url);

test("shared queues prefer operational status while terminal lifecycle remains authoritative", async () => {
  const source = await readFile(queueUrl, "utf8");
  assert.match(source, /TERMINAL_LIFECYCLES\.has\(lifecycle\) \? lifecycle : operationalStatus \|\| lifecycle/);
  assert.match(source, /workorder\.activityStatusLabel/);
});

test("detail status is one accessible control and terminal lifecycle disables it", async () => {
  const source = await readFile(detailUrl, "utf8");
  assert.match(source, /aria-label="Workorder status"/);
  assert.match(source, /disabled=\{terminal \|\| !view\.canChangeStatus \|\| controller\.busy\}/);
  assert.match(source, /role="alert"/);
});
