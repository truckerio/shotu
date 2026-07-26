import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { observeRequest, requestIdFor } from "./runtime.js";

test("request IDs accept safe proxy values and replace unsafe input", () => {
  assert.equal(requestIdFor({ headers: { "x-request-id": "railway-request-123" } }), "railway-request-123");
  assert.match(requestIdFor({ headers: { "x-request-id": "bad value\n" } }), /^[0-9a-f-]{36}$/);
});

test("request observation logs only pathname and bounded request metadata", () => {
  const response = new EventEmitter();
  response.statusCode = 200;
  response.setHeader = (name, value) => {
    response.headers ||= {};
    response.headers[name] = value;
  };
  const entries = [];
  let clock = 10;
  observeRequest(
    {
      method: "GET",
      url: "/api/office/dashboard?token=secret",
      headers: { host: "localhost", "x-request-id": "request-12345678" },
    },
    response,
    {
      logger: { log: (entry) => entries.push(JSON.parse(entry)) },
      now: () => clock,
    },
  );
  clock = 25;
  response.emit("finish");

  assert.equal(response.headers["x-request-id"], "request-12345678");
  assert.deepEqual(entries, [{
    type: "http_request",
    requestId: "request-12345678",
    method: "GET",
    path: "/api/office/dashboard",
    status: 200,
    durationMs: 15,
  }]);
});
