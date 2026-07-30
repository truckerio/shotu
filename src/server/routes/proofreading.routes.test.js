import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { resolveProofreadingConfig } from "../modules/proofreading/proofreading.config.js";
import {
  proofreadingDictionaryMutationSchema,
  proofreadingRequestSchema,
} from "../modules/proofreading/proofreading.schemas.js";
import { handleProofreadingApi } from "./proofreading.routes.js";

function request(method = "POST") {
  return Object.assign(new EventEmitter(), { destroyed: false, method });
}

function context(id = "user-route-test") {
  return {
    actor: { id, role: "mechanic" },
    companyIds: new Set(["10000000-0000-0000-0000-000000000001"]),
  };
}

test("proofreading input is bounded and defaults to US English", () => {
  assert.deepEqual(proofreadingRequestSchema.parse({ text: "brke pad" }), {
    language: "en-US",
    mode: "fast",
    text: "brke pad",
  });
  assert.throws(() => proofreadingRequestSchema.parse({ text: "ok" }));
  assert.throws(() => proofreadingRequestSchema.parse({ text: "x".repeat(5_001) }));
  assert.throws(() => proofreadingRequestSchema.parse({ text: "brke", extra: true }));
});

test("validation preserves whitespace so provider offsets still match the field", () => {
  assert.equal(proofreadingRequestSchema.parse({ text: "  brke pad" }).text, "  brke pad");
});

test("WProofreader credentials stay isolated in proofreading configuration", () => {
  assert.deepEqual(resolveProofreadingConfig({
    PROOFREADING_PROVIDER: "WProofreader",
    WPROOFREADER_SERVICE_ID: " service-id ",
  }), {
    provider: "wproofreader",
    cacheMaxEntries: 250,
    cacheTtlMs: 30_000,
    concurrencyLimit: 4,
    contextMinConfidence: 95,
    contextProvider: "disabled",
    contextTimeoutMs: 5_000,
    deepModeEnabled: false,
    deepTimeoutMs: 5_000,
    lexicalRecoveryMaxChars: 1_200,
    openAiApiBaseUrl: "https://api.openai.com/v1",
    openAiApiKey: "",
    openAiModel: "gpt-5.6-luna",
    timeoutMs: 3_000,
    wproofreaderServiceId: "service-id",
  });
});

test("dictionary mutations default to personal scope and reject extra keys", () => {
  assert.deepEqual(proofreadingDictionaryMutationSchema.parse({ term: "Bendix" }), {
    scope: "personal",
    term: "Bendix",
  });
  assert.throws(() => proofreadingDictionaryMutationSchema.parse({ term: "Bendix", ownerUserId: "attacker" }));
});

test("check route supplies the active company and personal dictionary union", async () => {
  let checked;
  let response;
  const req = request();
  const requestContext = context("route-check-user");
  const handled = await handleProofreadingApi(
    req,
    {},
    new URL("http://localhost/api/proofreading/check"),
    {
      readBody: async () => ({ text: "Replace brke pad." }),
      requestContext,
      sendJson: (_res, status, body) => { response = { body, status }; },
    },
    {
      check: async (input, options) => {
        checked = { input, options };
        return { issues: [], provider: "fake" };
      },
      listDictionary: async () => [{ term: "Bendix" }, { term: "Freightliner" }],
    },
  );

  assert.equal(handled, true);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { issues: [], provider: "fake" });
  assert.deepEqual(checked.input.dictionaryTerms, ["Bendix", "Freightliner"]);
  assert.equal(checked.input.mode, "fast");
  assert.ok(checked.options.signal instanceof AbortSignal);
});

test("check failures log bounded provider metadata without narrative text", async () => {
  let logged;
  let response;
  await handleProofreadingApi(
    request(),
    {},
    new URL("http://localhost/api/proofreading/check"),
    {
      readBody: async () => ({ text: "Sensitive customer narrative." }),
      requestContext: context("route-failure-user"),
      sendJson: (_res, status, body) => { response = { body, status }; },
    },
    {
      check: async () => {
        const error = new Error("WProofreader returned HTTP 403. Sensitive customer narrative.");
        error.cause = { code: "PROVIDER_DENIED" };
        throw error;
      },
      listDictionary: async () => [],
      logFailure: (details) => { logged = details; },
    },
  );

  assert.deepEqual(logged, {
    code: "PROVIDER_DENIED",
    event: "proofreading.check.failed",
    name: "Error",
    status: 403,
  });
  assert.equal(JSON.stringify(logged).includes("Sensitive"), false);
  assert.deepEqual(response, {
    body: { error: "Proofreading is temporarily unavailable." },
    status: 503,
  });
});

test("dictionary route never accepts a client-selected owner", async () => {
  let received;
  let response;
  await handleProofreadingApi(
    request(),
    {},
    new URL("http://localhost/api/proofreading/dictionary"),
    {
      readBody: async () => ({ term: "FleetTerm" }),
      requestContext: context("route-dictionary-user"),
      sendJson: (_res, status, body) => { response = { body, status }; },
    },
    {
      addPersonal: async (requestContext, input) => {
        received = { input, requestContext };
        return { scope: "personal", term: input.term };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.term, { scope: "personal", term: "FleetTerm" });
  assert.equal(received.requestContext.actor.id, "route-dictionary-user");
  assert.deepEqual(received.input, { scope: "personal", term: "FleetTerm" });
});
