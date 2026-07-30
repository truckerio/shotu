const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";
const WORD_PATTERN = /^[A-Za-z]+(?:['-][A-Za-z]+)*$/;

const CONTEXT_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          confidence: { type: "integer", minimum: 0, maximum: 100 },
          end: { type: "integer", minimum: 1 },
          message: { type: "string", minLength: 1, maxLength: 160 },
          original: { type: "string", minLength: 1, maxLength: 80 },
          start: { type: "integer", minimum: 0 },
          suggestion: { type: "string", minLength: 1, maxLength: 80 },
        },
        required: ["confidence", "end", "message", "original", "start", "suggestion"],
      },
    },
  },
  required: ["issues"],
});

function responseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const output of payload?.output || []) {
    for (const content of output?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function combinedSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

export function normalizeOpenAiContextIssues(text, payload, { minConfidence = 95 } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(responseText(payload));
  } catch {
    return [];
  }

  const candidates = Array.isArray(parsed?.issues) ? parsed.issues : [];
  const normalized = candidates.map((issue) => {
    const start = Number(issue?.start);
    const end = Number(issue?.end);
    const confidence = Number(issue?.confidence);
    const original = String(issue?.original || "");
    const suggestion = String(issue?.suggestion || "").trim();
    return {
      autoReplace: false,
      confidence,
      end,
      kind: "context",
      message: String(issue?.message || "Possible contextual word choice.").trim(),
      problem: original,
      start,
      suggestions: suggestion ? [suggestion] : [],
    };
  }).filter((issue) => (
    Number.isSafeInteger(issue.start)
      && Number.isSafeInteger(issue.end)
      && Number.isFinite(issue.confidence)
      && issue.confidence >= minConfidence
      && issue.start >= 0
      && issue.end > issue.start
      && issue.end <= text.length
      && text.slice(issue.start, issue.end) === issue.problem
      && WORD_PATTERN.test(issue.problem)
      && WORD_PATTERN.test(issue.suggestions[0] || "")
      && issue.problem.toLocaleLowerCase("en-US") !== issue.suggestions[0].toLocaleLowerCase("en-US")
  )).sort((left, right) => left.start - right.start || left.end - right.end);

  const nonOverlapping = [];
  for (const issue of normalized) {
    if (nonOverlapping.some((kept) => issue.start < kept.end && issue.end > kept.start)) continue;
    nonOverlapping.push(issue);
  }
  return nonOverlapping;
}

export function createOpenAiContextProvider({
  apiKey,
  baseUrl = DEFAULT_OPENAI_BASE_URL,
  fetchImpl = fetch,
  minConfidence = 95,
  model = DEFAULT_OPENAI_MODEL,
  timeoutMs = 5_000,
} = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for contextual proofreading.");
  const endpoint = `${String(baseUrl).replace(/\/$/, "")}/responses`;

  return Object.freeze({
    name: "openai-context",
    async check({ language = "en-US", signal, text }) {
      if (!String(language).startsWith("en") || text.trim().length < 8) return [];
      const response = await fetchImpl(endpoint, {
        body: JSON.stringify({
          input: [{
            role: "developer",
            content: [{
              type: "input_text",
              text: "Review the supplied maintenance workorder word by word for clear contextual word-choice errors, especially correctly spelled words or homophones used with the wrong meaning in repair language. Return exact zero-based character offsets into the original text and one replacement word only. Do not rewrite style, punctuation, names, part numbers, abbreviations, or technical terms. Omit uncertain findings.",
            }],
          }, {
            role: "user",
            content: [{ type: "input_text", text }],
          }],
          model,
          reasoning: { effort: "none" },
          store: false,
          text: {
            format: {
              type: "json_schema",
              name: "proofreading_context_issues",
              strict: true,
              schema: CONTEXT_RESPONSE_SCHEMA,
            },
            verbosity: "low",
          },
        }),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: combinedSignal(signal, timeoutMs),
      });
      if (!response.ok) throw new Error(`OpenAI contextual proofreading returned HTTP ${response.status}.`);
      return normalizeOpenAiContextIssues(text, await response.json(), { minConfidence });
    },
  });
}
