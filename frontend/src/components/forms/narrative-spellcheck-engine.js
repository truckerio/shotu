import { normalizeNarrativeIssues } from "./narrative-correction-model.js";

const PROOFREADING_PATH = "/api/proofreading/check";
const DICTIONARY_PATH = "/api/proofreading/dictionary";

export async function checkNarrativeSpelling(value, {
  companyId,
  mode = "fast",
  request = fetch,
  signal,
} = {}) {
  const text = String(value || "");
  if (text.trim().length < 3) return [];

  const response = await request(PROOFREADING_PATH, {
    body: JSON.stringify({
      text,
      language: "en-US",
      mode,
      ...(companyId ? { companyId } : {}),
    }),
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST",
    signal,
  });
  if (!response.ok) throw new Error("Proofreading is temporarily unavailable.");
  return normalizeNarrativeIssues(await response.json(), text);
}

export async function addNarrativeDictionaryWord(wordValue, {
  companyId,
  request = fetch,
  signal,
} = {}) {
  const term = String(wordValue || "").trim();
  if (!/^[a-z]+$/i.test(term)) throw new TypeError("Dictionary words must contain letters only.");
  const response = await request(DICTIONARY_PATH, {
    body: JSON.stringify({ term, ...(companyId ? { companyId } : {}) }),
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST",
    signal,
  });
  if (!response.ok) throw new Error("The word could not be added to your dictionary.");
  try {
    return await response.json();
  } catch {
    return { term };
  }
}
