import assert from "node:assert/strict";
import test from "node:test";
import { evaluateThresholds, Metrics } from "./metrics.js";

test("metrics compute percentiles, throughput, and threshold failures", () => {
  const metrics = new Metrics();
  for (const durationMs of [10, 20, 30, 40, 100]) {
    metrics.record({
      role: "office",
      label: "GET dashboard",
      durationMs,
      ok: durationMs !== 100,
      status: durationMs === 100 ? 500 : 200,
    });
  }
  const summary = metrics.summarize(1000);
  assert.equal(summary.overall.p50Ms, 30);
  assert.equal(summary.overall.p95Ms, 100);
  assert.equal(summary.overall.requestsPerSecond, 5);
  assert.equal(summary.overall.errorRate, 0.2);
  assert.deepEqual(evaluateThresholds(summary, {
    p95Ms: 50,
    p99Ms: 200,
    errorRate: 0.1,
    minRequestsPerSecond: 2,
  }).length, 2);
});
