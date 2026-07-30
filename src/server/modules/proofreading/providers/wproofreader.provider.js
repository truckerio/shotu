const WPROOFREADER_API_URL = "https://svc.webspellchecker.net/spellcheck31/api";
const WORD_PATTERN = /^[A-Za-z]+(?:['-][A-Za-z]+)*$/;

function uniqueSuggestions(suggestions) {
  return [...new Set((suggestions || []).map((item) => String(item || "").trim()))]
    .filter(Boolean)
    .slice(0, 5);
}

function languageCode(language) {
  return String(language || "en-US").replace("-", "_");
}

function normalizedDictionaryTerms(terms) {
  const seen = new Set();
  const values = [];
  for (const entry of Array.isArray(terms) ? terms : []) {
    const value = String(entry || "").normalize("NFKC").trim();
    if (!value || value.length > 64 || /[,\r\n]/u.test(value)) continue;
    const key = value.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(value);
    if (values.length >= 200 || values.join(",").length >= 4_000) break;
  }
  return values;
}

function normalizedRule(rule) {
  const value = typeof rule === "object" ? rule?.id : rule;
  const normalized = String(value || "").trim();
  return normalized || undefined;
}

function normalizedConfidence(confidence) {
  if (confidence === undefined || confidence === null || confidence === "") return undefined;
  const value = Number(confidence);
  if (!Number.isFinite(value)) return undefined;
  const percentage = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(percentage, 100));
}

function validRange(text, match) {
  const start = Number(match?.offset);
  const length = Number(match?.length);
  const end = start + length;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length)) return null;
  if (start < 0 || length <= 0 || end > text.length) return null;
  return { end, start };
}

function isSingleToken(value) {
  return WORD_PATTERN.test(value);
}

function baseIssue(text, match, range, kind, suggestions) {
  const issue = {
    end: range.end,
    kind,
    message: String(match.message || (kind === "grammar"
      ? "Possible grammar issue."
      : "Possible spelling mistake.")),
    problem: text.slice(range.start, range.end),
    start: range.start,
    suggestions,
  };
  const rule = normalizedRule(match.rule);
  const confidence = normalizedConfidence(match.confidence ?? match.probability);
  if (rule) issue.rule = rule;
  if (confidence !== undefined) issue.confidence = confidence;
  return issue;
}

export function normalizeWProofreaderMatches(text, matches) {
  const issues = [];
  const recoveryRanges = [];

  for (const match of Array.isArray(matches) ? matches : []) {
    if (!new Set(["grammar", "spelling"]).has(match?.type)) continue;
    const range = validRange(text, match);
    if (!range) continue;
    const suggestions = uniqueSuggestions(match.suggestions);

    if (match.type === "spelling") {
      if (suggestions.length) issues.push(baseIssue(text, match, range, "spelling", suggestions));
      continue;
    }

    const problem = text.slice(range.start, range.end);
    const safeSuggestions = suggestions.filter(isSingleToken);
    if (isSingleToken(problem) && safeSuggestions.length) {
      issues.push(baseIssue(text, match, range, "grammar", safeSuggestions));
    } else {
      recoveryRanges.push(range);
    }
  }

  return { issues, recoveryRanges };
}

function responseMatches(result) {
  return Array.isArray(result?.result)
    ? result.result.flatMap((entry) => entry?.matches || [])
    : [];
}

function overlaps(left, right) {
  return left.start < right.end && right.start < left.end;
}

export function mergeProofreadingIssues(...groups) {
  const kindPriority = { spelling: 0, grammar: 1, context: 2 };
  const candidates = groups.flat().filter(Boolean).sort((left, right) => (
    left.start - right.start
      || (left.end - left.start) - (right.end - right.start)
      || (kindPriority[left.kind] ?? 9) - (kindPriority[right.kind] ?? 9)
  ));
  const merged = [];

  for (const candidate of candidates) {
    const duplicate = merged.find((issue) => (
      issue.start === candidate.start
        && issue.end === candidate.end
        && issue.kind === candidate.kind
    ));
    if (duplicate) {
      duplicate.suggestions = uniqueSuggestions([...duplicate.suggestions, ...candidate.suggestions]);
      continue;
    }
    if (merged.some((issue) => overlaps(issue, candidate))) continue;
    merged.push({ ...candidate, suggestions: [...candidate.suggestions] });
  }
  return merged.sort((left, right) => left.start - right.start);
}

function mergedRanges(ranges) {
  const sorted = ranges
    .filter(Boolean)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const result = [];
  for (const range of sorted) {
    const previous = result.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

export function buildLexicalRecoveryPlan(text, ranges, maxChars = 1_200) {
  const segments = [];
  let recoveryText = "";
  for (const range of mergedRanges(ranges)) {
    const separator = recoveryText ? "\n" : "";
    const available = maxChars - recoveryText.length - separator.length;
    if (available <= 0) break;
    const original = text.slice(range.start, Math.min(range.end, range.start + available));
    if (!original) continue;
    recoveryText += separator;
    const recoveryStart = recoveryText.length;
    recoveryText += original;
    segments.push({
      originalStart: range.start,
      recoveryEnd: recoveryText.length,
      recoveryStart,
    });
  }
  return { recoveryText, segments };
}

export function remapRecoveryIssues(issues, plan, originalText) {
  return issues.flatMap((issue) => {
    const segment = plan.segments.find((candidate) => (
      issue.start >= candidate.recoveryStart && issue.end <= candidate.recoveryEnd
    ));
    if (!segment) return [];
    const start = segment.originalStart + issue.start - segment.recoveryStart;
    const end = start + issue.end - issue.start;
    return [{
      ...issue,
      end,
      problem: originalText.slice(start, end),
      start,
    }];
  });
}

async function requestCheck(fetchImpl, serviceId, bodyValues, signal) {
  const response = await fetchImpl(WPROOFREADER_API_URL, {
    body: new URLSearchParams({
      cmd: "check",
      customerid: serviceId,
      format: "json",
      ...bodyValues,
    }),
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
    signal,
  });
  if (!response.ok) throw new Error(`WProofreader returned HTTP ${response.status}.`);
  return response.json();
}

export function createWProofreaderProvider({
  deepTimeoutMs = 5_000,
  deepModeEnabled = false,
  fetchImpl = fetch,
  lexicalRecoveryMaxChars = 1_200,
  serviceId,
  timeoutMs = 3_000,
}) {
  if (!serviceId) throw new Error("WPROOFREADER_SERVICE_ID is required for the WProofreader provider.");

  return Object.freeze({
    name: "wproofreader",
    async check({ dictionaryTerms, language, mode = "fast", signal, text }) {
      const wantsDeep = mode === "deep" && deepModeEnabled;
      const deadlineSignal = AbortSignal.timeout(wantsDeep ? deepTimeoutMs : timeoutMs);
      const requestSignal = signal ? AbortSignal.any([signal, deadlineSignal]) : deadlineSignal;
      const dictionary = normalizedDictionaryTerms(dictionaryTerms);
      const common = {
        lang: languageCode(language),
        text,
        ...(dictionary.length ? { user_wordlist: dictionary.join(",") } : {}),
      };
      const fastRequest = requestCheck(fetchImpl, serviceId, common, requestSignal);
      const deepRequest = wantsDeep
        ? requestCheck(fetchImpl, serviceId, { ...common, enforce_ai: "true" }, requestSignal)
          .catch(() => null)
        : Promise.resolve(null);
      const fastResult = await fastRequest;
      const deepResult = await deepRequest;
      const fast = normalizeWProofreaderMatches(text, responseMatches(fastResult));
      const deep = deepResult
        ? normalizeWProofreaderMatches(text, responseMatches(deepResult))
        : { issues: [], recoveryRanges: [] };
      const recoveryRanges = [...fast.recoveryRanges, ...deep.recoveryRanges];
      let recovered = [];
      const recoveryPlan = buildLexicalRecoveryPlan(text, recoveryRanges, lexicalRecoveryMaxChars);
      if (recoveryPlan.recoveryText && !requestSignal.aborted) {
        try {
          const recoveryResult = await requestCheck(fetchImpl, serviceId, {
            disable_grammar: "true",
            lang: languageCode(language),
            text: recoveryPlan.recoveryText,
          }, requestSignal);
          const lexical = normalizeWProofreaderMatches(
            recoveryPlan.recoveryText,
            responseMatches(recoveryResult).filter((match) => match?.type === "spelling"),
          );
          recovered = remapRecoveryIssues(lexical.issues, recoveryPlan, text);
        } catch {
          // Lexical recovery is best effort; preserve all safe primary issues.
        }
      }

      const dictionaryKeys = new Set(dictionary.map((term) => term.toLocaleLowerCase("en-US")));
      return mergeProofreadingIssues(fast.issues, deep.issues, recovered)
        .filter((issue) => !dictionaryKeys.has(issue.problem.normalize("NFKC").trim().toLocaleLowerCase("en-US")));
    },
  });
}
