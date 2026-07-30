const PROOFREADING_PATH = "/api/proofreading/check";

function normalizedIssues(body, textLength) {
  if (!Array.isArray(body?.issues)) return [];
  return body.issues
    .filter((issue) => (
      Number.isSafeInteger(issue?.start)
        && Number.isSafeInteger(issue?.end)
        && issue.start >= 0
        && issue.end > issue.start
        && issue.end <= textLength
        && Array.isArray(issue.suggestions)
        && issue.suggestions.length > 0
    ))
    .sort((left, right) => left.start - right.start);
}

export async function checkNarrativeSpelling(value, { request = fetch } = {}) {
  const text = String(value || "");
  if (text.trim().length < 3) return [];

  const response = await request(PROOFREADING_PATH, {
    body: JSON.stringify({ text, language: "en-US" }),
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("Proofreading is temporarily unavailable.");
  return normalizedIssues(await response.json(), text.length);
}
