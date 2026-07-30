import assert from "node:assert/strict";
import test from "node:test";
import { checkNarrativeSpelling } from "./narrative-spellcheck-engine.js";

test("the shared client requests normalized proofreading suggestions", async () => {
  let received;
  const request = async (path, options) => {
    received = { path, options };
    return {
      ok: true,
      async json() {
        return {
          issues: [{
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
  const lints = await checkNarrativeSpelling("inpectn", { request });

  assert.equal(lints.length, 1);
  assert.equal(lints[0].suggestions[0], "inspect");
  assert.equal(received.path, "/api/proofreading/check");
  assert.deepEqual(JSON.parse(received.options.body), { text: "inpectn", language: "en-US" });
});

test("short and empty text stays local", async () => {
  const request = async () => assert.fail("short text should not call the provider");
  assert.deepEqual(await checkNarrativeSpelling(" ", { request }), []);
  assert.deepEqual(await checkNarrativeSpelling("ok", { request }), []);
});
