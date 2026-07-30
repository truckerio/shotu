import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { checkNarrativeText } from "../../src/server/modules/proofreading/proofreading.service.js";

function decimalSetting(name, fallback, minimum, maximum) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(parsed, maximum)) : fallback;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function expectedKey(problem, suggestion) {
  return `${problem.toLocaleLowerCase("en-US")}→${suggestion.toLocaleLowerCase("en-US")}`;
}

function issueMatches(issue, [problem, suggestion]) {
  return issue.problem.toLocaleLowerCase("en-US") === problem.toLocaleLowerCase("en-US")
    && issue.suggestions.some((value) => (
      value.toLocaleLowerCase("en-US") === suggestion.toLocaleLowerCase("en-US")
    ));
}

export async function runProofreadingBenchmark({
  corpus,
  check = checkNarrativeText,
  mode = "deep",
} = {}) {
  const cases = [];
  for (const sample of corpus) {
    const started = performance.now();
    const result = await check({ language: "en-US", mode, text: sample.text });
    const latencyMs = Math.round(performance.now() - started);
    const issues = result.issues || [];
    const found = sample.expected.filter((expected) => (
      issues.some((issue) => issueMatches(issue, expected))
    ));
    const expectedKeys = new Set(sample.expected.map(([problem, suggestion]) => expectedKey(problem, suggestion)));
    const unexpected = issues.filter((issue) => !issue.suggestions.some((suggestion) => (
      expectedKeys.has(expectedKey(issue.problem, suggestion))
    )));
    cases.push({
      expected: sample.expected.length,
      found: found.length,
      id: sample.id,
      issues: issues.length,
      latencyMs,
      missed: sample.expected.filter((expected) => (
        !issues.some((issue) => issueMatches(issue, expected))
      )),
      unexpected: unexpected.map(({ kind, problem, suggestions }) => ({ kind, problem, suggestions })),
    });
  }

  const expected = cases.reduce((total, sample) => total + sample.expected, 0);
  const found = cases.reduce((total, sample) => total + sample.found, 0);
  const latencies = cases.map((sample) => sample.latencyMs);
  return {
    cases,
    summary: {
      expected,
      found,
      mode,
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      recall: expected ? found / expected : 1,
      unexpected: cases.reduce((total, sample) => total + sample.unexpected.length, 0),
    },
  };
}

async function main() {
  const corpusPath = new URL("./corpus.json", import.meta.url);
  const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
  const report = await runProofreadingBenchmark({ corpus });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  const minimumRecall = decimalSetting("PROOFREADING_BENCHMARK_MIN_RECALL", 0.75, 0, 1);
  const maximumP95 = decimalSetting("PROOFREADING_BENCHMARK_MAX_P95_MS", 6_000, 250, 60_000);
  const maximumUnexpected = decimalSetting("PROOFREADING_BENCHMARK_MAX_UNEXPECTED", 5, 0, 100);
  if (
    report.summary.recall < minimumRecall
      || report.summary.p95LatencyMs > maximumP95
      || report.summary.unexpected > maximumUnexpected
  ) process.exitCode = 1;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`Proofreading benchmark failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
