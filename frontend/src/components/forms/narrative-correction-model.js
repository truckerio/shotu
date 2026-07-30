const ISSUE_KINDS = new Set(["spelling", "grammar", "context"]);
const KIND_PRIORITY = Object.freeze({ spelling: 0, grammar: 1, context: 2 });
const ALPHABETIC_WORD = /^[a-z]+$/;
const DELIMITER = /^[\s.,!?;:]$/;

function normalizedSuggestions(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((suggestion) => (
    typeof suggestion === "string" ? suggestion.trim() : ""
  )).filter(Boolean))].slice(0, 5);
}

function highConfidence(issue) {
  const numericConfidence = typeof issue?.confidence === "number" ? issue.confidence : null;
  return issue?.autoReplace === true
    || issue?.confidence === "high"
    || (numericConfidence !== null && (
      (numericConfidence >= 0.9 && numericConfidence <= 1)
        || numericConfidence >= 90
    ));
}

export function issueOccurrenceKey(issue) {
  return `${issue.kind}:${issue.start}:${issue.end}:${issue.problem.toLocaleLowerCase("en-US")}`;
}

export function normalizeNarrativeIssues(body, textValue) {
  const text = String(textValue || "");
  const candidates = Array.isArray(body?.issues) ? body.issues : [];
  const normalized = candidates.flatMap((issue) => {
    const start = issue?.start;
    const end = issue?.end;
    const kind = String(issue?.kind || "").toLowerCase();
    if (
      !Number.isSafeInteger(start)
      || !Number.isSafeInteger(end)
      || start < 0
      || end <= start
      || end > text.length
      || !ISSUE_KINDS.has(kind)
    ) return [];

    const problem = text.slice(start, end);
    if (typeof issue?.problem !== "string" || issue.problem !== problem) return [];
    const suggestions = normalizedSuggestions(issue.suggestions);
    if (!suggestions.length) return [];

    return [{
      autoReplace: issue.autoReplace === true,
      confidence: typeof issue.confidence === "number" || issue.confidence === "high"
        ? issue.confidence
        : null,
      end,
      kind,
      message: typeof issue.message === "string" ? issue.message : "",
      problem,
      start,
      suggestions,
    }];
  });

  normalized.sort((left, right) => (
    left.start - right.start
    || KIND_PRIORITY[left.kind] - KIND_PRIORITY[right.kind]
    || left.end - right.end
  ));

  const nonOverlapping = [];
  let coveredUntil = -1;
  for (const issue of normalized) {
    if (issue.start < coveredUntil) continue;
    nonOverlapping.push(issue);
    coveredUntil = issue.end;
  }
  return nonOverlapping;
}

export function canAutoReplaceNarrativeIssue({
  issue,
  text: textValue,
  selectionStart,
  selectionEnd,
  isComposing = false,
}) {
  const text = String(textValue || "");
  if (
    isComposing
    || issue?.kind !== "spelling"
    || !highConfidence(issue)
    || issue.suggestions?.length !== 1
    || !ALPHABETIC_WORD.test(issue.problem)
    || !ALPHABETIC_WORD.test(issue.suggestions[0])
    || text.slice(issue.start, issue.end) !== issue.problem
  ) return false;

  const delimiter = text.slice(issue.end, issue.end + 1);
  return DELIMITER.test(delimiter)
    && selectionStart === issue.end + 1
    && selectionEnd === selectionStart;
}
