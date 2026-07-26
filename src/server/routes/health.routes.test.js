import assert from "node:assert/strict";
import test from "node:test";
import { checkReadiness } from "../operations/readiness.service.js";
import { handleHealthRoute } from "./health.routes.js";

function responseCapture() {
  const result = {};
  return {
    result,
    sendJson(_res, status, body) {
      result.status = status;
      result.body = body;
    },
  };
}

test("liveness is process-only and does not query the database", async () => {
  const capture = responseCapture();
  let queried = false;
  const handled = await handleHealthRoute(
    { method: "GET" },
    {},
    new URL("http://localhost/health/live"),
    {
      sendJson: capture.sendJson,
      readinessCheck: async () => {
        queried = true;
        return { status: "ready", database: "available", latencyMs: 0 };
      },
    },
  );

  assert.equal(handled, true);
  assert.equal(queried, false);
  assert.deepEqual(capture.result, { status: 200, body: { status: "alive" } });
});

test("readiness reports database availability without exposing errors", async () => {
  const capture = responseCapture();
  await handleHealthRoute(
    { method: "GET" },
    {},
    new URL("http://localhost/health/ready"),
    {
      sendJson: capture.sendJson,
      readinessCheck: async () => {
        throw new Error("postgres://secret@host/database");
      },
    },
  );

  assert.equal(capture.result.status, 503);
  assert.deepEqual(capture.result.body, {
    status: "not_ready",
    database: "unavailable",
  });
});

test("readiness returns bounded latency metadata", async () => {
  const report = await checkReadiness({ queryDatabase: async () => ({ rows: [{ ready: 1 }] }) });
  assert.equal(report.status, "ready");
  assert.equal(report.database, "available");
  assert.equal(Number.isInteger(report.latencyMs), true);
});
