import { createHash } from "node:crypto";
import { createWProofreaderProvider, mergeProofreadingIssues } from "./providers/wproofreader.provider.js";
import { createOpenAiContextProvider } from "./providers/openai-context.provider.js";
import { resolveProofreadingConfig } from "./proofreading.config.js";

let cachedService;
let cachedSignature;

function cacheKey(input) {
  const dictionary = [...new Set((input.dictionaryTerms || [])
    .map((term) => String(term || "").normalize("NFKC").trim().toLocaleLowerCase("en-US"))
    .filter(Boolean))]
    .sort();
  return createHash("sha256")
    .update(JSON.stringify({
      companyId: input.companyId || "",
      dictionary,
      language: input.language,
      mode: input.mode || "fast",
      text: input.text,
    }))
    .digest("base64url");
}

function copyResult(result) {
  return {
    ...result,
    issues: result.issues.map((issue) => ({
      ...issue,
      suggestions: [...issue.suggestions],
    })),
  };
}

function normalizedDictionarySet(terms) {
  return new Set((Array.isArray(terms) ? terms : [])
    .map((term) => String(term || "").normalize("NFKC").trim().toLocaleLowerCase("en-US"))
    .filter(Boolean));
}

function suppressDictionaryIssues(issues, terms) {
  const dictionary = normalizedDictionarySet(terms);
  if (!dictionary.size) return issues;
  return issues.filter((issue) => !dictionary.has(
    String(issue.problem || "").normalize("NFKC").trim().toLocaleLowerCase("en-US"),
  ));
}

function createSemaphore(limit) {
  let active = 0;
  const queue = [];

  function dispatch() {
    while (active < limit && queue.length) {
      const entry = queue.shift();
      if (entry.signal?.aborted) {
        entry.reject(entry.signal.reason || new DOMException("Aborted", "AbortError"));
        continue;
      }
      active += 1;
      entry.signal?.removeEventListener("abort", entry.onAbort);
      entry.resolve(() => {
        if (entry.released) return;
        entry.released = true;
        active -= 1;
        dispatch();
      });
    }
  }

  return {
    acquire(signal) {
      if (signal?.aborted) return Promise.reject(signal.reason || new DOMException("Aborted", "AbortError"));
      return new Promise((resolve, reject) => {
        const entry = { onAbort: null, reject, released: false, resolve, signal };
        entry.onAbort = () => {
          const index = queue.indexOf(entry);
          if (index >= 0) queue.splice(index, 1);
          reject(signal.reason || new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", entry.onAbort, { once: true });
        queue.push(entry);
        dispatch();
      });
    },
  };
}

function awaitWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason || new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason || new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function createProofreadingService({
  cacheMaxEntries = 250,
  cacheTtlMs = 30_000,
  concurrencyLimit = 4,
  contextProvider = null,
  contextTimeoutMs = 5_000,
  deepTimeoutMs = 5_000,
  now = Date.now,
  provider,
  timeoutMs = 3_000,
} = {}) {
  if (!provider?.check) throw new TypeError("A proofreading provider is required.");
  const cache = new Map();
  const inFlight = new Map();
  const semaphore = createSemaphore(concurrencyLimit);

  function cached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      cache.delete(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, entry);
    return copyResult(entry.result);
  }

  function store(key, result) {
    cache.delete(key);
    cache.set(key, { expiresAt: now() + cacheTtlMs, result: copyResult(result) });
    while (cache.size > cacheMaxEntries) cache.delete(cache.keys().next().value);
  }

  async function run(input) {
    const controller = new AbortController();
    const deadlineMs = input.mode === "deep"
      ? Math.max(deepTimeoutMs, contextTimeoutMs)
      : timeoutMs;
    const timer = setTimeout(() => {
      controller.abort(new DOMException("Proofreading deadline exceeded.", "TimeoutError"));
    }, deadlineMs);
    let release;
    try {
      release = await semaphore.acquire(controller.signal);
      const primaryPromise = provider.check({ ...input, signal: controller.signal });
      const contextPromise = input.mode === "deep" && contextProvider?.check
        ? contextProvider.check({ ...input, signal: controller.signal }).catch(() => [])
        : Promise.resolve([]);
      const [primaryIssues, contextualIssues] = await Promise.all([primaryPromise, contextPromise]);
      const issues = suppressDictionaryIssues(
        mergeProofreadingIssues(primaryIssues, contextualIssues),
        input.dictionaryTerms,
      );
      return { issues, provider: provider.name };
    } finally {
      clearTimeout(timer);
      if (!controller.signal.aborted) controller.abort(new DOMException("Proofreading complete.", "AbortError"));
      release?.();
    }
  }

  return Object.freeze({
    async check(input, { signal } = {}) {
      const normalizedInput = { ...input, mode: input.mode || "fast" };
      const key = cacheKey(normalizedInput);
      const cacheHit = cached(key);
      if (cacheHit) return awaitWithSignal(Promise.resolve(cacheHit), signal);

      let task = inFlight.get(key);
      if (!task) {
        task = run(normalizedInput).then((result) => {
          store(key, result);
          return result;
        });
        inFlight.set(key, task);
        task.then(
          () => inFlight.delete(key),
          () => inFlight.delete(key),
        );
      }
      return copyResult(await awaitWithSignal(task, signal));
    },
  });
}

function configuredProofreadingService() {
  const config = resolveProofreadingConfig();
  const signature = createHash("sha256").update(JSON.stringify(config)).digest("base64url");
  if (cachedService && cachedSignature === signature) return cachedService;
  if (config.provider !== "wproofreader") {
    throw new Error(`Unsupported proofreading provider: ${config.provider}.`);
  }

  const provider = createWProofreaderProvider({
    deepTimeoutMs: config.deepTimeoutMs,
    deepModeEnabled: config.deepModeEnabled,
    lexicalRecoveryMaxChars: config.lexicalRecoveryMaxChars,
    serviceId: config.wproofreaderServiceId,
    timeoutMs: config.timeoutMs,
  });
  const contextProvider = config.deepModeEnabled
    && config.contextProvider === "openai"
    && config.openAiApiKey
    ? createOpenAiContextProvider({
      apiKey: config.openAiApiKey,
      baseUrl: config.openAiApiBaseUrl,
      minConfidence: config.contextMinConfidence,
      model: config.openAiModel,
      timeoutMs: config.contextTimeoutMs,
    })
    : null;
  cachedService = createProofreadingService({
    cacheMaxEntries: config.cacheMaxEntries,
    cacheTtlMs: config.cacheTtlMs,
    concurrencyLimit: config.concurrencyLimit,
    contextProvider,
    contextTimeoutMs: config.contextTimeoutMs,
    deepTimeoutMs: config.deepTimeoutMs,
    provider,
    timeoutMs: config.timeoutMs,
  });
  cachedSignature = signature;
  return cachedService;
}

export async function checkNarrativeText(input, { contextProvider, provider, service, signal } = {}) {
  if (service) return service.check(input, { signal });
  if (provider) {
    return createProofreadingService({ contextProvider, provider }).check(input, { signal });
  }
  return configuredProofreadingService().check(input, { signal });
}
