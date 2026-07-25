import { partsHelperConfig } from "../parts-helper.config.js";
import { requireSupportedTruck } from "../supported-trucks.js";

let cachedRows = null;
let cacheExpiresAt = 0;

function headers(config) {
  return config.huggingFaceToken ? { authorization: `Bearer ${config.huggingFaceToken}` } : {};
}

function rowValue(entry) {
  return entry?.row && typeof entry.row === "object" ? entry.row : null;
}

async function fetchDatasetRows({ fetchFn, config }) {
  if (cachedRows && Date.now() < cacheExpiresAt) return cachedRows;

  const rows = [];
  const pageSize = 100;
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const params = new URLSearchParams({
      dataset: config.huggingFaceDataset,
      config: "default",
      split: "train",
      offset: String(offset),
      length: String(pageSize),
    });
    const response = await fetchFn(`${config.huggingFaceBaseUrl}/rows?${params}`, {
      headers: headers(config),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Hugging Face dataset request failed (${response.status}).`);
    const page = await response.json();
    const pageRows = Array.isArray(page.rows) ? page.rows.map(rowValue).filter(Boolean) : [];
    rows.push(...pageRows);
    total = Number(page.num_rows_total ?? rows.length);
    if (!pageRows.length) break;
    offset += pageRows.length;
  }

  cachedRows = rows;
  cacheExpiresAt = Date.now() + Math.max(1, config.huggingFaceCacheMinutes) * 60_000;
  return rows;
}

const normalized = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function rowFamily(row) {
  const make = normalized(row.make);
  const model = normalized(row.model);
  if (make.includes("volvo")) return "volvo";
  if (make.includes("peterbilt")) return "peterbilt";
  if (make.includes("freightliner") && model.includes("cascadia")) return "cascadia";
  return null;
}

function matchScore(row, vehicle, family) {
  if (rowFamily(row) !== family) return -1;
  const wantedModel = normalized(vehicle.model);
  const rowModel = normalized(row.model);
  let score = 10;
  if (wantedModel && rowModel === wantedModel) score += 100;
  else if (wantedModel && (rowModel.includes(wantedModel) || wantedModel.includes(rowModel))) score += 60;
  if (vehicle.engine && normalized(row.engines).includes(normalized(vehicle.engine))) score += 25;
  return score;
}

export async function findHuggingFaceTruckContext(vehicle, options = {}) {
  const family = requireSupportedTruck(vehicle);
  const config = options.config || partsHelperConfig;
  const fetchFn = options.fetchFn || fetch;
  const rows = await fetchDatasetRows({ fetchFn, config });
  const matches = rows
    .map((row) => ({ row, score: matchScore(row, vehicle, family) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score);
  const best = matches[0]?.row || null;

  return {
    provider: "huggingface",
    dataset: config.huggingFaceDataset,
    family,
    matched: Boolean(best),
    vehicle: best ? {
      make: best.make || "",
      model: best.model || "",
      years: best.years || "",
      classes: best.classes || "",
      bodyType: best.body_type || "",
      engines: String(best.engines || "").split(";").map((value) => value.trim()).filter(Boolean),
      applications: String(best.applications || "").split(";").map((value) => value.trim()).filter(Boolean),
    } : null,
  };
}

export function clearHuggingFaceCache() {
  cachedRows = null;
  cacheExpiresAt = 0;
}

