import assert from "node:assert/strict";
import test from "node:test";
import { runProofreadingBenchmark } from "./benchmark.js";

test("benchmark reports recall, unexpected findings, and latency without provider coupling", async () => {
  const corpus = [{
    expected: [["brke", "brake"]],
    id: "sample",
    text: "Replace brke pad.",
  }];
  const report = await runProofreadingBenchmark({
    corpus,
    check: async () => ({
      issues: [{ kind: "spelling", problem: "brke", suggestions: ["brake"] }],
    }),
  });

  assert.equal(report.summary.expected, 1);
  assert.equal(report.summary.found, 1);
  assert.equal(report.summary.recall, 1);
  assert.equal(report.summary.unexpected, 0);
  assert.equal(report.cases[0].missed.length, 0);
});
