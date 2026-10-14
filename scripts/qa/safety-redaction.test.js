import assert from "node:assert/strict";
import test from "node:test";
import { redactQaError } from "./safety.js";

test("QA diagnostics redact JSON-quoted credential headers", () => {
  const input = JSON.stringify({ headers: { cookie: "session=private-cookie", "x-api-key": "private-key", authorization: "Basic private-basic", "set-cookie": "private-set-cookie", "proxy-authorization": "private-proxy" }, url: "/api/me" });
  const output = redactQaError(input);
  for (const value of ["private-cookie", "private-key", "private-basic", "private-set-cookie", "private-proxy"]) assert.equal(output.includes(value), false);
  assert.match(output, /\/api\/me/);
});

test("QA timeout logs never reveal cookies, authorization or API keys", () => {
  const message = redactQaError(new Error("Timeout exceeded\n - cookie: session=private-session; preference=private\n - Authorization: Bearer private-bearer\n - x-api-key: private-api-key\n - → GET http://localhost:4176/api/me"));
  for (const value of ["private-session", "private-bearer", "private-api-key", "preference=private"]) assert.equal(message.includes(value), false);
  assert.match(message, /GET http:\/\/localhost:4176\/api\/me/);
  assert.match(message, /cookie: \[REDACTED\]/);
});

test("QA errors redact standalone bearer values, URI passwords and caller secrets", () => {
  const message = redactQaError("Bearer session-value postgresql://tester:database-password@localhost/qa explicit-password", ["explicit-password"]);
  assert.equal(message.includes("session-value"), false);
  assert.equal(message.includes("database-password"), false);
  assert.equal(message.includes("explicit-password"), false);
  assert.match(message, /postgresql:\/\/tester:\[REDACTED\]@localhost\/qa/);
});
