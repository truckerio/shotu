import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  InvalidJsonBodyError,
  RequestBodyTooLargeError,
  UnsupportedMediaTypeError,
} from "./errors.js";
import { readJsonBody } from "./body.js";

function request(chunks, headers = {}) {
  const stream = Readable.from(chunks);
  stream.headers = headers;
  return stream;
}

test("reads JSON within the declared and streamed limits", async () => {
  const body = '{"name":"workorder"}';
  const parsed = await readJsonBody(request([body], {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
  }), { maxBytes: 100 });

  assert.deepEqual(parsed, { name: "workorder" });
});

test("rejects oversized declared bodies before consuming the stream", async () => {
  await assert.rejects(
    readJsonBody(request(['{"ok":true}'], {
      "content-type": "application/json",
      "content-length": "101",
    }), { maxBytes: 100 }),
    RequestBodyTooLargeError,
  );
});

test("rejects streamed bodies that exceed the limit without Content-Length", async () => {
  await assert.rejects(
    readJsonBody(request(["12345", "67890"], {
      "content-type": "application/json",
    }), { maxBytes: 8 }),
    RequestBodyTooLargeError,
  );
});

test("rejects invalid JSON and non-JSON media types with stable HTTP errors", async () => {
  await assert.rejects(
    readJsonBody(request(["{"], { "content-type": "application/json" })),
    InvalidJsonBodyError,
  );
  await assert.rejects(
    readJsonBody(request(['{"ok":true}'], { "content-type": "text/plain" })),
    UnsupportedMediaTypeError,
  );
});

test("empty bodies use the configured empty value", async () => {
  assert.deepEqual(
    await readJsonBody(request([], {
      "content-type": "application/json",
      "content-length": "0",
    })),
    {},
  );
});
