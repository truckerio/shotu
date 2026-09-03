import assert from "node:assert/strict";
import test from "node:test";
import { RoleApiClient, RoleWorkflowHttpError } from "./api-client.js";

function client(response) {
  return new RoleApiClient({ role: "mechanic", context: { fetch: async () => response }, baseUrl: new URL("http://localhost:4173/") });
}

test("binary client request preserves authenticated context response bytes and PDF content type", async () => {
  const bytes = Buffer.from("%PDF-qa");
  const result = await client({ status: () => 200, headers: () => ({ "content-type": "application/pdf" }), body: async () => bytes }).requestBytes("/download", { expectedContentType: "application/pdf" });
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.contentType, "application/pdf");
});

test("binary client request rejects a non-PDF content type", async () => {
  await assert.rejects(
    client({ status: () => 200, headers: () => ({ "content-type": "text/html" }), body: async () => Buffer.from("html") }).requestBytes("/download", { expectedContentType: "application/pdf" }),
    (error) => error instanceof RoleWorkflowHttpError && error.code === "UNEXPECTED_CONTENT_TYPE",
  );
});
