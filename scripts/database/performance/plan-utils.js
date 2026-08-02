const UUID_PATTERN = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi;

export function sanitizePlan(value) {
  if (typeof value === "string") return value.replaceAll(UUID_PATTERN, "<uuid>");
  if (Array.isArray(value)) return value.map(sanitizePlan);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizePlan(item)]));
  }
  return value;
}

export function planMetrics(explainDocument) {
  const document = Array.isArray(explainDocument) ? explainDocument[0] : explainDocument;
  const plan = document?.Plan || {};
  return {
    planningTimeMs: Number(document?.["Planning Time"] || 0),
    executionTimeMs: Number(document?.["Execution Time"] || 0),
    rootNode: plan["Node Type"] || "unknown",
    actualRows: Number(plan["Actual Rows"] || 0),
    sharedHitBlocks: Number(plan["Shared Hit Blocks"] || 0),
    sharedReadBlocks: Number(plan["Shared Read Blocks"] || 0),
    temporaryReadBlocks: Number(plan["Temp Read Blocks"] || 0),
    temporaryWrittenBlocks: Number(plan["Temp Written Blocks"] || 0),
  };
}

function normalizedDefinition(definition) {
  return String(definition || "")
    .toLowerCase()
    .replaceAll(/\s+/g, " ")
    .replaceAll('"', "");
}

export function recommendationStatus(indexRows, recommendation) {
  const definitions = indexRows
    .filter((row) => row.tablename === recommendation.table)
    .map((row) => normalizedDefinition(row.indexdef));
  const covered = definitions.some((definition) => {
    let cursor = -1;
    return recommendation.columns.every((column) => {
      cursor = definition.indexOf(column.toLowerCase(), cursor + 1);
      return cursor >= 0;
    });
  });
  return { ...recommendation, covered };
}
