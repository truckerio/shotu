import assert from "node:assert/strict";
import test from "node:test";
import {
  addNarrativeDictionaryWord,
  checkNarrativeSpelling,
} from "./narrative-spellcheck-engine.js";

test("the shared client requests revision-safe proofreading categories", async () => {
  let received;
  const controller = new AbortController();
  const request = async (path, options) => {
    received = { path, options };
    return {
      ok: true,
      async json() {
        return {
          issues: [{
            autoReplace: true,
            end: 7,
            kind: "spelling",
            message: "Possible spelling mistake.",
            problem: "inpectn",
            start: 0,
            suggestions: ["inspect"],
          }],
        };
      },
    };
  };
  const issues = await checkNarrativeSpelling("inpectn", {
    companyId: "company-1",
    mode: "deep",
    request,
    signal: controller.signal,
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0].suggestions[0], "inspect");
  assert.equal(received.path, "/api/proofreading/check");
  assert.equal(received.options.signal, controller.signal);
  assert.deepEqual(JSON.parse(received.options.body), {
    text: "inpectn",
    language: "en-US",
    mode: "deep",
    companyId: "company-1",
  });
});

test("short and empty text stays local", async () => {
  const request = async () => assert.fail("short text should not call the provider");
  assert.deepEqual(await checkNarrativeSpelling(" ", { request }), []);
  assert.deepEqual(await checkNarrativeSpelling("ok", { request }), []);
});

test("default fast checks omit company context unless a caller provides it", async () => {
  let body;
  await checkNarrativeSpelling("brke", {
    request: async (_path, options) => {
      body = JSON.parse(options.body);
      return { ok: true, async json() { return { issues: [] }; } };
    },
  });
  assert.deepEqual(body, { text: "brke", language: "en-US", mode: "fast" });
});

test("the dictionary client normalizes a word and forwards cancellation", async () => {
  let received;
  const controller = new AbortController();
  const result = await addNarrativeDictionaryWord("  FleetTerm ", {
    companyId: "company-1",
    signal: controller.signal,
    request: async (path, options) => {
      received = { path, options };
      return { ok: true, async json() { return { term: "FleetTerm" }; } };
    },
  });

  assert.deepEqual(result, { term: "FleetTerm" });
  assert.equal(received.path, "/api/proofreading/dictionary");
  assert.equal(received.options.signal, controller.signal);
  assert.deepEqual(JSON.parse(received.options.body), { term: "FleetTerm", companyId: "company-1" });
  await assert.rejects(() => addNarrativeDictionaryWord("A90801"), /letters only/);
});

test("a successful empty dictionary response still returns the submitted term", async () => {
  const result = await addNarrativeDictionaryWord("Samsara", {
    request: async () => ({
      ok: true,
      async json() { throw new SyntaxError("empty response"); },
    }),
  });
  assert.deepEqual(result, { term: "Samsara" });
});
