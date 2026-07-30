import assert from "node:assert/strict";
import test from "node:test";
import { createWProofreaderProvider } from "./providers/wproofreader.provider.js";
import { checkNarrativeText } from "./proofreading.service.js";

test("WProofreader is normalized behind the shared provider contract", async () => {
  let received;
  const provider = createWProofreaderProvider({
    serviceId: "test-service-id",
    fetchImpl: async (url, options) => {
      received = { options, url };
      return {
        ok: true,
        async json() {
          return {
            result: [{ matches: [{
              length: 5,
              message: "Spelling mistake",
              offset: 10,
              suggestions: ["change", "charge"],
              type: "spelling",
            }] }],
          };
        },
      };
    },
  });

  const result = await checkNarrativeText({ language: "en-US", text: "brake pad chage" }, { provider });

  assert.equal(result.provider, "wproofreader");
  assert.deepEqual(result.issues, [{
    end: 15,
    kind: "spelling",
    message: "Spelling mistake",
    problem: "chage",
    start: 10,
    suggestions: ["change", "charge"],
  }]);
  assert.equal(received.url, "https://svc.webspellchecker.net/spellcheck31/api");
  assert.equal(new URLSearchParams(received.options.body).get("text"), "brake pad chage");
  assert.equal(new URLSearchParams(received.options.body).get("customerid"), "test-service-id");
  assert.equal(new URLSearchParams(received.options.body).get("lang"), "en_US");
});

test("grammar-only matches do not create red spelling underlines", async () => {
  const provider = createWProofreaderProvider({
    serviceId: "test-service-id",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          result: [{ matches: [{
            length: 3,
            offset: 0,
            suggestions: ["An"],
            type: "grammar",
          }] }],
        };
      },
    }),
  });

  assert.deepEqual((await provider.check({ language: "en-US", text: "A example" })), []);
});
