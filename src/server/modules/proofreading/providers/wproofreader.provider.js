const WPROOFREADER_API_URL = "https://svc.webspellchecker.net/spellcheck31/api";

function uniqueSuggestions(suggestions) {
  return [...new Set((suggestions || []).map((item) => String(item || "").trim()))]
    .filter(Boolean)
    .slice(0, 5);
}

function languageCode(language) {
  return String(language || "en-US").replace("-", "_");
}

export function normalizeWProofreaderMatches(text, matches) {
  return (Array.isArray(matches) ? matches : [])
    .filter((match) => match?.type === "spelling")
    .map((match) => {
      const start = Number(match.offset);
      const length = Number(match.length);
      return {
        end: start + length,
        kind: "spelling",
        message: String(match.message || "Possible spelling mistake."),
        problem: text.slice(start, start + length),
        start,
        suggestions: uniqueSuggestions(match.suggestions),
      };
    })
    .filter((issue) => (
      Number.isSafeInteger(issue.start)
        && Number.isSafeInteger(issue.end)
        && issue.start >= 0
        && issue.end <= text.length
        && issue.end > issue.start
        && issue.suggestions.length > 0
    ))
    .sort((left, right) => left.start - right.start);
}

export function createWProofreaderProvider({ serviceId, fetchImpl = fetch, timeoutMs = 3_000 }) {
  if (!serviceId) throw new Error("WPROOFREADER_SERVICE_ID is required for the WProofreader provider.");

  return Object.freeze({
    name: "wproofreader",
    async check({ language, text }) {
      const body = new URLSearchParams({
        cmd: "check",
        customerid: serviceId,
        format: "json",
        lang: languageCode(language),
        out_type: "words",
        text,
      });
      const response = await fetchImpl(WPROOFREADER_API_URL, {
        body,
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`WProofreader returned HTTP ${response.status}.`);
      const result = await response.json();
      const matches = Array.isArray(result?.result)
        ? result.result.flatMap((entry) => entry?.matches || [])
        : [];
      return normalizeWProofreaderMatches(text, matches);
    },
  });
}
