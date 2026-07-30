import assert from "node:assert/strict";
import test from "node:test";
import {
  createWProofreaderProvider,
  mergeProofreadingIssues,
  normalizeWProofreaderMatches,
} from "./providers/wproofreader.provider.js";
import { resolveProofreadingConfig } from "./proofreading.config.js";
import { proofreadingRequestSchema } from "./proofreading.schemas.js";
import { checkNarrativeText, createProofreadingService } from "./proofreading.service.js";

const DIFFICULT_SENTENCE = "The mecanic inspcted teh air compresor and fownd a sever presure leeke near teh regulater, but the vehical also had intermitent electrcl falts, corroded conectors, uneaven brke pad ware, and a transsmision vibraition that becme noticable durring accelration.";

function okResponse(matches) {
  return {
    ok: true,
    async json() {
      return { result: [{ matches }] };
    },
  };
}

function match(text, problem, options = {}) {
  const offset = text.indexOf(problem, options.after || 0);
  assert.notEqual(offset, -1, `fixture problem not found: ${problem}`);
  return {
    length: problem.length,
    offset,
    suggestions: options.suggestions || [],
    type: options.type || "spelling",
    ...(options.message ? { message: options.message } : {}),
    ...(options.rule ? { rule: options.rule } : {}),
    ...(options.confidence !== undefined ? { confidence: options.confidence } : {}),
  };
}

test("normalizes spelling and safe single-token grammar with optional metadata", () => {
  const text = "Brake pad is sever.";
  const normalized = normalizeWProofreaderMatches(text, [
    match(text, "Brake", { suggestions: ["Break"], type: "spelling" }),
    match(text, "sever", {
      confidence: 98,
      message: "Did you mean severe?",
      rule: { id: "CONFUSED_WORD" },
      suggestions: ["severe", "very severe"],
      type: "grammar",
    }),
  ]);

  assert.deepEqual(normalized.recoveryRanges, []);
  assert.equal(normalized.issues[0].kind, "spelling");
  assert.deepEqual(normalized.issues[1], {
    confidence: 98,
    end: text.indexOf("sever") + 5,
    kind: "grammar",
    message: "Did you mean severe?",
    problem: "sever",
    rule: "CONFUSED_WORD",
    start: text.indexOf("sever"),
    suggestions: ["severe"],
  });
});

test("normalizes WProofreader probability into percentage confidence", () => {
  const text = "A sever leak.";
  const normalized = normalizeWProofreaderMatches(text, [
    {
      ...match(text, "sever", { suggestions: ["severe"], type: "grammar" }),
      probability: 0.989,
    },
  ]);

  assert.equal(normalized.issues[0].confidence, 98.9);
});

test("recovers electrcl, falts, and brke from unsafe grammar spans in the exact difficult sentence", async () => {
  const calls = [];
  const primaryMatches = [
    ...[
      ["mecanic", "mechanic"], ["inspcted", "inspected"], ["teh", "the"],
      ["compresor", "compressor"], ["fownd", "found"], ["presure", "pressure"],
      ["leeke", "leak"], ["regulater", "regulator"], ["vehical", "vehicle"],
      ["intermitent", "intermittent"], ["conectors", "connectors"], ["uneaven", "uneven"],
      ["ware", "wear"], ["transsmision", "transmission"], ["vibraition", "vibration"],
      ["becme", "became"], ["noticable", "noticeable"], ["durring", "during"],
      ["accelration", "acceleration"],
    ].map(([problem, suggestion]) => match(DIFFICULT_SENTENCE, problem, { suggestions: [suggestion] })),
    match(DIFFICULT_SENTENCE, "sever", {
      message: "Did you mean severe?",
      rule: "CONFUSED_WORD",
      suggestions: ["severe"],
      type: "grammar",
    }),
    match(DIFFICULT_SENTENCE, "electrcl falts", {
      suggestions: ["electrical faults"],
      type: "grammar",
    }),
    match(DIFFICULT_SENTENCE, " brke pad ware, and", {
      suggestions: [" brake pad wear, and"],
      type: "grammar",
    }),
  ];
  const provider = createWProofreaderProvider({
    serviceId: "test-service-id",
    fetchImpl: async (_url, options) => {
      const body = new URLSearchParams(options.body);
      calls.push(body);
      if (body.get("disable_grammar") !== "true") return okResponse(primaryMatches);
      const recoveryText = body.get("text");
      return okResponse([
        match(recoveryText, "electrcl", { suggestions: ["electrical"] }),
        match(recoveryText, "falts", { suggestions: ["faults"] }),
        match(recoveryText, "brke", { suggestions: ["brake"] }),
      ]);
    },
  });

  const result = await checkNarrativeText({
    language: "en-US",
    mode: "fast",
    text: DIFFICULT_SENTENCE,
  }, { provider });

  assert.equal(calls.length, 2, "only one lexical recovery request is allowed");
  assert.equal(calls[1].get("disable_grammar"), "true");
  for (const [problem, suggestion, kind] of [
    ["sever", "severe", "grammar"],
    ["electrcl", "electrical", "spelling"],
    ["falts", "faults", "spelling"],
    ["brke", "brake", "spelling"],
  ]) {
    const issue = result.issues.find((candidate) => candidate.problem === problem);
    assert.ok(issue, `${problem} should survive normalization and recovery`);
    assert.equal(issue.start, DIFFICULT_SENTENCE.indexOf(problem));
    assert.equal(issue.kind, kind);
    assert.equal(issue.suggestions[0], suggestion);
  }
});

test("deep AI failure preserves fast WProofreader results", async () => {
  const text = "brke pad";
  let calls = 0;
  const provider = createWProofreaderProvider({
    deepModeEnabled: true,
    serviceId: "test-service-id",
    fetchImpl: async (_url, options) => {
      calls += 1;
      const body = new URLSearchParams(options.body);
      if (body.get("enforce_ai") === "true") throw new Error("AI unavailable");
      return okResponse([match(text, "brke", { suggestions: ["brake"] })]);
    },
  });

  const issues = await provider.check({ language: "en-US", mode: "deep", text });
  assert.equal(calls, 2);
  assert.equal(issues[0].suggestions[0], "brake");
});

test("deep classic and AI start concurrently before one bounded targeted lexical recovery", async () => {
  const text = "mecanic has electrcl falts";
  const started = [];
  const pending = new Map();
  const bodies = new Map();
  const provider = createWProofreaderProvider({
    deepModeEnabled: true,
    serviceId: "test-service-id",
    fetchImpl: async (_url, options) => {
      const body = new URLSearchParams(options.body);
      const kind = body.get("enforce_ai") === "true"
        ? "deep"
        : body.get("disable_grammar") === "true" ? "lexical" : "fast";
      started.push(kind);
      bodies.set(kind, body);
      return new Promise((resolve) => pending.set(kind, resolve));
    },
  });
  const resultPromise = provider.check({ language: "en-US", mode: "deep", text });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual([...started].sort(), ["deep", "fast"]);
  pending.get("fast")(okResponse([
    match(text, "electrcl falts", { suggestions: ["electrical faults"], type: "grammar" }),
  ]));
  pending.get("deep")(okResponse([]));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual([...started].sort(), ["deep", "fast", "lexical"]);
  assert.equal(bodies.get("lexical").get("text"), "electrcl falts");
  assert.equal(bodies.get("lexical").get("text").includes("mecanic"), false);
  const recoveryText = bodies.get("lexical").get("text");
  pending.get("lexical")(okResponse([
    match(recoveryText, "electrcl", { suggestions: ["electrical"] }),
    match(recoveryText, "falts", { suggestions: ["faults"] }),
  ]));
  const issues = await resultPromise;

  assert.deepEqual(issues.map((issue) => issue.problem), ["electrcl", "falts"]);
  assert.equal(issues[0].start, text.indexOf("electrcl"));
  assert.equal(issues[1].start, text.indexOf("falts"));
});

test("WProofreader keeps separate fast and deep deadlines", async () => {
  async function elapsed(mode) {
    const startedAt = Date.now();
    const keepAlive = setTimeout(() => {}, 150);
    const provider = createWProofreaderProvider({
      deepModeEnabled: true,
      deepTimeoutMs: 70,
      serviceId: "test-service-id",
      timeoutMs: 20,
      fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    });
    try {
      await assert.rejects(provider.check({ language: "en-US", mode, text: "slow provider" }));
      return Date.now() - startedAt;
    } finally {
      clearTimeout(keepAlive);
    }
  }

  const fastElapsed = await elapsed("fast");
  const deepElapsed = await elapsed("deep");
  assert.ok(fastElapsed < 55, `fast deadline was too slow: ${fastElapsed}ms`);
  assert.ok(deepElapsed >= 55, `deep deadline fired too early: ${deepElapsed}ms`);
});

test("lexical recovery failure preserves safe primary results", async () => {
  const text = "brke pads need service";
  let calls = 0;
  const provider = createWProofreaderProvider({
    serviceId: "test-service-id",
    fetchImpl: async (_url, options) => {
      calls += 1;
      const body = new URLSearchParams(options.body);
      if (body.get("disable_grammar") === "true") throw new Error("recovery unavailable");
      return okResponse([
        match(text, "service", { suggestions: ["serviced"] }),
        match(text, "brke pads", { suggestions: ["brake pads"], type: "grammar" }),
      ]);
    },
  });

  const issues = await provider.check({ language: "en-US", text });
  assert.equal(calls, 2);
  assert.deepEqual(issues.map((issue) => issue.problem), ["service"]);
});

test("malformed and overlapping ranges never produce overlapping issues", () => {
  const text = "sever brke";
  const normalized = normalizeWProofreaderMatches(text, [
    { length: 99, offset: 0, suggestions: ["bad"], type: "spelling" },
    { length: 2, offset: -1, suggestions: ["bad"], type: "spelling" },
    match(text, "sever", { suggestions: ["severe"], type: "grammar" }),
    match(text, "sever", { suggestions: ["server"], type: "spelling" }),
  ]);
  const merged = mergeProofreadingIssues(normalized.issues);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].kind, "spelling");
});

test("multi-sentence offsets remain relative to the original text", () => {
  const text = "First sentence is fine. Second sentence has a falts.";
  const offset = text.indexOf("falts");
  const normalized = normalizeWProofreaderMatches(text, [{
    length: 5,
    offset,
    suggestions: ["fault"],
    type: "spelling",
  }]);

  assert.equal(normalized.issues[0].start, offset);
  assert.equal(normalized.issues[0].problem, "falts");
});

test("dictionary terms are bounded upstream and suppressed locally", async () => {
  const text = "Inspect Samsara sensor";
  let body;
  const provider = createWProofreaderProvider({
    serviceId: "test-service-id",
    fetchImpl: async (_url, options) => {
      body = new URLSearchParams(options.body);
      return okResponse([match(text, "Samsara", { suggestions: ["Samara"] })]);
    },
  });
  const issues = await provider.check({
    dictionaryTerms: ["samsara", "Samsara", "bad,term"],
    language: "en-US",
    text,
  });

  assert.equal(body.get("user_wordlist"), "samsara");
  assert.deepEqual(issues, []);
});

test("service coalesces identical checks and serves a bounded TTL cache", async () => {
  let calls = 0;
  let now = 1_000;
  let finish;
  const provider = {
    name: "test",
    check: async () => {
      calls += 1;
      await new Promise((resolve) => { finish = resolve; });
      return [];
    },
  };
  const service = createProofreadingService({ cacheMaxEntries: 2, cacheTtlMs: 50, now: () => now, provider });
  const input = { language: "en-US", mode: "fast", text: "brke pad" };
  const first = service.check(input);
  const second = service.check(input);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish();
  await Promise.all([first, second]);
  await service.check(input);
  assert.equal(calls, 1);

  now += 51;
  const expired = service.check(input);
  await Promise.resolve();
  assert.equal(calls, 2);
  finish();
  await expired;
});

test("service concurrency is bounded", async () => {
  let active = 0;
  let maximum = 0;
  const releases = [];
  const provider = {
    name: "test",
    async check() {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      return [];
    },
  };
  const service = createProofreadingService({ concurrencyLimit: 1, provider });
  const first = service.check({ language: "en-US", text: "first value" });
  const second = service.check({ language: "en-US", text: "second value" });
  await Promise.resolve();
  assert.equal(maximum, 1);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maximum, 1);
  releases.shift()();
  await Promise.all([first, second]);
});

test("service aborts a provider that exceeds its deadline", async () => {
  const provider = {
    name: "test",
    check: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  };
  const service = createProofreadingService({ provider, timeoutMs: 20 });

  await assert.rejects(
    service.check({ language: "en-US", text: "slow provider" }),
    (error) => error?.name === "TimeoutError",
  );
});

test("contextual deep-check failure remains fail-open", async () => {
  const provider = { name: "test", check: async () => [{
    end: 4,
    kind: "spelling",
    message: "Spelling",
    problem: "brke",
    start: 0,
    suggestions: ["brake"],
  }] };
  const contextProvider = { check: async () => { throw new Error("context unavailable"); } };
  const service = createProofreadingService({ contextProvider, provider });
  const result = await service.check({ language: "en-US", mode: "deep", text: "brke pad" });

  assert.equal(result.issues[0].problem, "brke");
});

test("deep mode starts contextual and primary checks in parallel", async () => {
  let primaryStarted = false;
  let contextStarted = false;
  let releasePrimary;
  let releaseContext;
  const provider = {
    name: "test",
    async check() {
      primaryStarted = true;
      await new Promise((resolve) => { releasePrimary = resolve; });
      return [];
    },
  };
  const contextProvider = {
    async check() {
      contextStarted = true;
      await new Promise((resolve) => { releaseContext = resolve; });
      return [];
    },
  };
  const service = createProofreadingService({ contextProvider, provider });
  const result = service.check({ language: "en-US", mode: "deep", text: "brake pedal feels loose" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(primaryStarted, true);
  assert.equal(contextStarted, true);
  releasePrimary();
  releaseContext();
  await result;
});

test("deep mode uses the longer contextual deadline while fast mode stays bounded", async () => {
  const abortTimes = [];
  const startedAt = Date.now();
  const provider = {
    name: "test",
    check: ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        abortTimes.push(Date.now() - startedAt);
        reject(signal.reason);
      }, { once: true });
    }),
  };
  const contextProvider = {
    check: ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  };
  const service = createProofreadingService({
    contextProvider,
    contextTimeoutMs: 60,
    deepTimeoutMs: 20,
    provider,
    timeoutMs: 20,
  });

  await assert.rejects(
    service.check({ language: "en-US", mode: "deep", text: "slow deep provider" }),
    (error) => error?.name === "TimeoutError",
  );
  assert.ok(abortTimes[0] >= 45, `deep deadline fired too early: ${abortTimes[0]}ms`);
});

test("schema supports scoped fast and deep requests", () => {
  const companyId = "3ac30e45-fd03-42dc-ab20-05f8992298ed";
  assert.deepEqual(proofreadingRequestSchema.parse({ companyId, text: "brke pad" }), {
    companyId,
    language: "en-US",
    mode: "fast",
    text: "brke pad",
  });
  assert.equal(proofreadingRequestSchema.parse({ mode: "deep", text: "brke pad" }).mode, "deep");
  assert.throws(() => proofreadingRequestSchema.parse({ mode: "automatic", text: "brke pad" }));
  assert.throws(() => proofreadingRequestSchema.parse({ companyId: "not-a-uuid", text: "brke pad" }));
});

test("configuration clamps expensive controls to safe bounds", () => {
  const config = resolveProofreadingConfig({
    PROOFREADING_CACHE_MAX_ENTRIES: "99999",
    PROOFREADING_CACHE_TTL_MS: "1",
    PROOFREADING_CONCURRENCY_LIMIT: "0",
    PROOFREADING_CONTEXT_MIN_CONFIDENCE: "20",
    PROOFREADING_CONTEXT_TIMEOUT_MS: "99999",
    PROOFREADING_DEEP_MODE_ENABLED: "true",
    PROOFREADING_DEEP_TIMEOUT_MS: "99999",
    PROOFREADING_RECOVERY_MAX_CHARS: "99999",
    PROOFREADING_TIMEOUT_MS: "99999",
  });

  assert.equal(config.cacheMaxEntries, 1_000);
  assert.equal(config.cacheTtlMs, 1_000);
  assert.equal(config.concurrencyLimit, 1);
  assert.equal(config.contextMinConfidence, 80);
  assert.equal(config.contextTimeoutMs, 5_000);
  assert.equal(config.deepModeEnabled, true);
  assert.equal(config.deepTimeoutMs, 10_000);
  assert.equal(config.lexicalRecoveryMaxChars, 5_000);
  assert.equal(config.timeoutMs, 10_000);
});
