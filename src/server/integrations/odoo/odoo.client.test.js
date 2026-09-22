import assert from "node:assert/strict";
import { test } from "node:test";
import { OdooClient } from "./odoo.client.js";
import { IntegrationHttpError } from "../core/integration-errors.js";

function failingClient(cause) {
  let calls = 0;
  return {
    client: new OdooClient({ baseUrl: "https://staging.example.odoo.com", database: "shop", username: "admin", apiKey: "private-test-key",
      fetchImpl: async () => { calls += 1; throw new TypeError("fetch failed", { cause }); },
    }),
    callCount: () => calls,
  };
}

test("Odoo DNS failures identify the unreachable host without exposing credentials or retrying", async () => {
  for (const code of ["ENOENT", "ENOTFOUND", "EAI_AGAIN"]) {
    const { client, callCount } = failingClient({ code, message: "private-test-key" });
    await assert.rejects(client.authenticate(), (error) => {
      assert.ok(error instanceof IntegrationHttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "ODOO_TRANSPORT_ERROR");
      assert.match(error.message, /Cannot resolve.*staging\.example\.odoo\.com/);
      assert.match(error.message, /Credentials could not be verified/);
      assert.doesNotMatch(error.message, /private-test-key/);
      return true;
    });
    assert.equal(callCount(), 1);
  }
});

test("refused connections and certificate failures give distinct safe explanations", async () => {
  for (const [cause, expected] of [
    [{ code: "ECONNREFUSED" }, /refused the connection/],
    [{ errors: [{ code: "ECONNREFUSED" }] }, /refused the connection/],
    [{ code: "CERT_HAS_EXPIRED" }, /certificate could not be verified/],
    [{ code: "ECONNRESET" }, /ended before a response/],
  ]) {
    const { client } = failingClient(cause);
    await assert.rejects(client.authenticate(), (error) => error.code === "ODOO_TRANSPORT_ERROR" && expected.test(error.message));
  }
});
