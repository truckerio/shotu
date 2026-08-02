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
    endpointP95Ms: { "GET dashboard": 50 },
  }).length, 3);
});

test("route budgets are evaluated independently from aggregate thresholds", () => {
  const metrics = new Metrics();
  metrics.record({ role: "admin", label: "GET operations page", durationMs: 40, ok: true, status: 200 });
  metrics.record({ role: "surveillance", label: "GET surveillance dashboard", durationMs: 220, ok: true, status: 200 });
  const failures = evaluateThresholds(metrics.summarize(1000), {
    p95Ms: 500,
    p99Ms: 500,
    errorRate: 0,
    minRequestsPerSecond: 0,
    endpointP95Ms: {
      "GET operations page": 100,
      "GET surveillance dashboard": 200,
    },
  });
  assert.deepEqual(failures, ["surveillance GET surveillance dashboard p95 220ms exceeded 200ms."]);
});
