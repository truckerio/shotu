import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpenAiContextProvider,
  normalizeOpenAiContextIssues,
} from "./providers/openai-context.provider.js";

test("contextual provider uses a non-storing strict Responses request", async () => {
  let request;
  const provider = createOpenAiContextProvider({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      request = { options, url };
      return {
        ok: true,
        async json() {
          return {
            output: [{ content: [{
              type: "output_text",
              text: JSON.stringify({ issues: [{
                confidence: 99,
                end: 19,
                message: "Use the adjective severe here.",
                original: "sever",
                start: 14,
                suggestion: "severe",
              }] }),
            }] }],
          };
        },
      };
    },
  });

  const issues = await provider.check({ text: "The truck has sever damage.", language: "en-US" });
  const body = JSON.parse(request.options.body);

  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.options.headers.authorization, "Bearer test-key");
  assert.equal(body.model, "gpt-5.6-luna");
  assert.equal(body.store, false);
  assert.equal(body.reasoning.effort, "none");
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(issues, [{
    autoReplace: false,
    confidence: 99,
    end: 19,
    kind: "context",
    message: "Use the adjective severe here.",
    problem: "sever",
    start: 14,
    suggestions: ["severe"],
  }]);
});

test("contextual findings must be high-confidence exact single-word ranges", () => {
  const text = "brake pad ware";
  const payload = {
    output_text: JSON.stringify({ issues: [
      { confidence: 99, end: 14, message: "Use wear.", original: "ware", start: 10, suggestion: "wear" },
      { confidence: 80, end: 9, message: "Uncertain.", original: "pad", start: 6, suggestion: "pads" },
      { confidence: 99, end: 5, message: "Wrong source slice.", original: "break", start: 0, suggestion: "brake" },
      { confidence: 99, end: 14, message: "No phrases.", original: "pad ware", start: 6, suggestion: "pad wear" },
    ] }),
  };

  assert.deepEqual(normalizeOpenAiContextIssues(text, payload), [{
    autoReplace: false,
    confidence: 99,
    end: 14,
    kind: "context",
    message: "Use wear.",
    problem: "ware",
    start: 10,
    suggestions: ["wear"],
  }]);
});
