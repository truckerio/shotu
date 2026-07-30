import { ZodError } from "zod";
import { RateLimitExceededError, createInMemoryRateLimiter } from "../security/index.js";
import {
  proofreadingDictionaryMutationSchema,
  proofreadingRequestSchema,
} from "../modules/proofreading/proofreading.schemas.js";
import { checkNarrativeText } from "../modules/proofreading/proofreading.service.js";
import {
  addCompanyProofreadingTerm,
  addPersonalProofreadingTerm,
  listProofreadingDictionary,
  removeCompanyProofreadingTerm,
  removePersonalProofreadingTerm,
} from "../modules/proofreading/proofreading-dictionaries.service.js";

const DICTIONARY_CACHE_TTL_MS = 30_000;
const DICTIONARY_CACHE_MAX_ENTRIES = 1_000;
const dictionaryCache = new Map();
const proofreadingRateLimiter = createInMemoryRateLimiter({ limit: 180, windowMs: 60_000 });

function selectedCompanyId(requestContext, companyId) {
  if (companyId) return companyId;
  const companyIds = [...(requestContext?.companyIds || [])];
  return companyIds.length === 1 ? companyIds[0] : "";
}

function dictionaryCacheKey(requestContext, companyId) {
  return `${requestContext.actor.id}:${selectedCompanyId(requestContext, companyId)}`;
}

function storeDictionary(key, terms) {
  dictionaryCache.delete(key);
  dictionaryCache.set(key, { expiresAt: Date.now() + DICTIONARY_CACHE_TTL_MS, terms });
  while (dictionaryCache.size > DICTIONARY_CACHE_MAX_ENTRIES) {
    dictionaryCache.delete(dictionaryCache.keys().next().value);
  }
}

async function cachedDictionary(requestContext, companyId, listDictionary) {
  const key = dictionaryCacheKey(requestContext, companyId);
  const cached = dictionaryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    dictionaryCache.delete(key);
    dictionaryCache.set(key, cached);
    return cached.terms;
  }
  if (cached) dictionaryCache.delete(key);
  const terms = await listDictionary(requestContext, { companyId });
  storeDictionary(key, terms);
  return terms;
}

function invalidateDictionary(requestContext, companyId, scope) {
  const selected = selectedCompanyId(requestContext, companyId);
  if (scope === "personal") {
    dictionaryCache.delete(`${requestContext.actor.id}:${selected}`);
    return;
  }
  for (const key of dictionaryCache.keys()) {
    if (key.endsWith(`:${selected}`)) dictionaryCache.delete(key);
  }
}

function consumeRateLimit(requestContext, cost = 1) {
  const result = proofreadingRateLimiter.consume(`proofreading:${requestContext.actor.id}`, cost);
  if (!result.allowed) throw new RateLimitExceededError(result);
}

function abortSignalForRequest(req) {
  const controller = new AbortController();
  const onAborted = () => controller.abort(new DOMException("Request aborted.", "AbortError"));
  req.once?.("aborted", onAborted);
  return {
    signal: controller.signal,
    dispose: () => req.removeListener?.("aborted", onAborted),
  };
}

export async function handleProofreadingApi(req, res, url, helpers, dependencies = {}) {
  if (!url.pathname.startsWith("/api/proofreading/")) return false;
  const check = dependencies.check || checkNarrativeText;
  const listDictionary = dependencies.listDictionary || listProofreadingDictionary;
  const addCompany = dependencies.addCompany || addCompanyProofreadingTerm;
  const addPersonal = dependencies.addPersonal || addPersonalProofreadingTerm;
  const removeCompany = dependencies.removeCompany || removeCompanyProofreadingTerm;
  const removePersonal = dependencies.removePersonal || removePersonalProofreadingTerm;

  if (url.pathname === "/api/proofreading/dictionary" && req.method === "GET") {
    consumeRateLimit(helpers.requestContext);
    const companyId = url.searchParams.get("companyId") || undefined;
    helpers.sendJson(res, 200, {
      terms: await cachedDictionary(helpers.requestContext, companyId, listDictionary),
    });
    return true;
  }

  if (
    url.pathname === "/api/proofreading/dictionary"
      && (req.method === "POST" || req.method === "DELETE")
  ) {
    consumeRateLimit(helpers.requestContext, 5);
    let input;
    try {
      input = proofreadingDictionaryMutationSchema.parse(await helpers.readBody(req));
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      helpers.sendJson(res, 400, { error: error.issues[0]?.message || "Enter a valid dictionary term." });
      return true;
    }
    const mutator = input.scope === "company"
      ? (req.method === "POST" ? addCompany : removeCompany)
      : (req.method === "POST" ? addPersonal : removePersonal);
    const term = await mutator(helpers.requestContext, input);
    invalidateDictionary(helpers.requestContext, input.companyId, input.scope);
    helpers.sendJson(res, 200, { term });
    return true;
  }

  if (url.pathname !== "/api/proofreading/check" || req.method !== "POST") return false;

  let input;
  try {
    input = proofreadingRequestSchema.parse(await helpers.readBody(req));
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    helpers.sendJson(res, 400, { error: error.issues[0]?.message || "Enter valid text to proofread." });
    return true;
  }

  consumeRateLimit(helpers.requestContext, input.mode === "deep" ? 3 : 1);
  const dictionary = await cachedDictionary(helpers.requestContext, input.companyId, listDictionary);
  const requestAbort = abortSignalForRequest(req);
  try {
    helpers.sendJson(res, 200, await check({
      ...input,
      dictionaryTerms: dictionary.map((entry) => entry.term),
    }, { signal: requestAbort.signal }));
  } catch (error) {
    if (error?.name === "AbortError" && req.destroyed) return true;
    helpers.sendJson(res, 503, { error: "Proofreading is temporarily unavailable." });
  } finally {
    requestAbort.dispose();
  }
  return true;
}
