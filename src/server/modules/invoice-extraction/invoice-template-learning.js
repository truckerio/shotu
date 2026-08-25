import crypto from "node:crypto";

const SCALAR_FIELDS = [
  "vendorName",
  "vendorAccount",
  "invoiceNumber",
  "invoiceDate",
  "purchaseOrderNumber",
  "subtotal",
  "tax",
  "shipping",
  "total",
];

const LINE_FIELDS = ["partNumber", "description", "quantity", "unitOfMeasure", "unitPrice", "lineTotal"];

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function round(value, places = 4) {
  const scale = 10 ** places;
  return Math.round(Number(value) * scale) / scale;
}

function normalizedText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function markerDigest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function comparableText(value) {
  if (typeof value === "number") return String(round(value, 4));
  const text = String(value ?? "").trim();
  const numeric = text.replace(/[$,\s]/g, "").replace(/\(([^)]+)\)/, "-$1");
  if (/^-?\d+(?:\.\d+)?$/.test(numeric)) return String(Number(numeric));
  return normalizedText(text);
}

function valueShape(value) {
  const text = String(value ?? "").trim();
  if (/^[-+]?\s*[$€£]?\s*\d[\d,]*(?:\.\d{1,4})?(?:\s*-)?$/.test(text)) return "number";
  if (/^(?:\d{1,4}[-/.]){2}\d{1,4}$/.test(text)) return "date";
  if (/^[a-z]*\d[a-z0-9 ./_-]*$/i.test(text) || /^\d+[a-z][a-z0-9 ./_-]*$/i.test(text)) return "identifier";
  if (/^[a-z][a-z .,&'/-]+$/i.test(text)) return "text";
  return "mixed";
}

function regionBounds(region, pageWidth, pageHeight) {
  if (Array.isArray(region.polygon) && region.polygon.length >= 3) {
    const xs = region.polygon.map((point) => Number(point[0]) || 0);
    const ys = region.polygon.map((point) => Number(point[1]) || 0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      x: clamp(minX / pageWidth),
      y: clamp(minY / pageHeight),
      width: clamp((maxX - minX) / pageWidth),
      height: clamp((maxY - minY) / pageHeight),
    };
  }
  const scaleX = Number(region.x) > 1 || Number(region.width) > 1 ? pageWidth : 1;
  const scaleY = Number(region.y) > 1 || Number(region.height) > 1 ? pageHeight : 1;
  return {
    x: clamp(Number(region.x) / scaleX),
    y: clamp(Number(region.y) / scaleY),
    width: clamp(Number(region.width) / scaleX),
    height: clamp(Number(region.height) / scaleY),
  };
}

export function normalizeOcrObservation(observation) {
  const pageWidth = Math.max(1, Number(observation?.width) || 1);
  const pageHeight = Math.max(1, Number(observation?.height) || 1);
  const regions = (observation?.regions || []).flatMap((region, index) => {
    const text = String(region?.text || "").trim();
    if (!text) return [];
    const bounds = regionBounds(region, pageWidth, pageHeight);
    if (!bounds.width || !bounds.height) return [];
    return [{
      index,
      text,
      normalized: normalizedText(text),
      shape: valueShape(text),
      confidence: clamp(region.confidence ?? 0),
      box: Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, round(value)])),
    }];
  });
  return { width: pageWidth, height: pageHeight, regions };
}

function stableMarker(region, excludedIndexes) {
  if (excludedIndexes.has(region.index)) return "";
  if (region.normalized.length < 4 || region.normalized.length > 80) return "";
  if (/\d/.test(region.normalized)) return "";
  if (region.shape === "number" || region.shape === "date" || region.shape === "identifier") return "";
  return region.normalized;
}

function fieldValue(draft, path) {
  const field = draft?.[path];
  return field && typeof field === "object" && Object.hasOwn(field, "value") ? field.value : null;
}

function matchingRegions(regions, value) {
  const expected = comparableText(value);
  if (!expected) return [];
  return regions.filter((region) => comparableText(region.text) === expected);
}

function nearbyStableLabels(regions, target, excludedIndexes) {
  const targetCenterY = target.box.y + target.box.height / 2;
  return regions
    .filter((region) => {
      if (!stableMarker(region, excludedIndexes)) return false;
      const centerY = region.box.y + region.box.height / 2;
      const leftOfTarget = region.box.x + region.box.width <= target.box.x + 0.02;
      return leftOfTarget && Math.abs(centerY - targetCenterY) <= Math.max(0.04, target.box.height * 2.5);
    })
    .sort((left, right) => Math.abs((left.box.x + left.box.width) - target.box.x) - Math.abs((right.box.x + right.box.width) - target.box.x))
    .slice(0, 2)
    .map((region) => markerDigest(region.normalized));
}

function learnedAnchor(fieldPath, region, regions, excludedIndexes) {
  return {
    fieldPath,
    box: region.box,
    valueShape: region.shape,
    labels: nearbyStableLabels(regions, region, excludedIndexes),
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function centerY(region) {
  return region.box.y + region.box.height / 2;
}

function learnTableStructure(regions, reviewedDraft, excludedIndexes, scalarMatches) {
  const columns = [];
  const rowCenters = [];
  const matchedByField = new Map(LINE_FIELDS.map((fieldName) => [fieldName, []]));
  const matchedRegions = [];
  for (const line of reviewedDraft?.lines || []) {
    const candidateLists = new Map(LINE_FIELDS.map((fieldName) => [
      fieldName,
      matchingRegions(regions, line?.[fieldName]?.value),
    ]));
    const rowAnchors = ["partNumber", "description"]
      .flatMap((fieldName) => candidateLists.get(fieldName)?.length === 1 ? candidateLists.get(fieldName) : []);
    if (!rowAnchors.length) continue;
    const rowCenter = median(rowAnchors.map(centerY));
    rowCenters.push(rowCenter);
    for (const fieldName of LINE_FIELDS) {
      const candidates = candidateLists.get(fieldName) || [];
      const closest = [...candidates].sort((left, right) => Math.abs(centerY(left) - rowCenter) - Math.abs(centerY(right) - rowCenter))[0];
      if (!closest || Math.abs(centerY(closest) - rowCenter) > 0.055) continue;
      matchedByField.get(fieldName).push(closest);
      matchedRegions.push(closest);
      excludedIndexes.add(closest.index);
    }
  }
  for (const fieldName of LINE_FIELDS) {
    const matches = matchedByField.get(fieldName);
    if (!matches.length) continue;
    columns.push({
      fieldName,
      centerX: round(median(matches.map((region) => region.box.x + region.box.width / 2))),
      sampleCount: matches.length,
      valueShape: matches.length === 1 ? matches[0].shape : null,
    });
  }
  const totalMatch = scalarMatches.find(({ fieldPath }) => fieldPath === "total")?.region;
  const medianHeight = median(matchedRegions.map((region) => region.box.height)) || 0.015;
  return {
    columns,
    bounds: rowCenters.length ? {
      topY: round(Math.max(0, Math.min(...rowCenters) - Math.max(0.01, medianHeight * 0.6))),
      bottomY: round(totalMatch && totalMatch.box.y > Math.max(...rowCenters)
        ? Math.max(0, totalMatch.box.y - 0.02)
        : Math.min(1, Math.max(...rowCenters) + 0.18)),
      rowTolerance: round(Math.min(0.04, Math.max(0.012, medianHeight * 1.5))),
    } : null,
  };
}

function canonicalTemplatePayload(template) {
  return {
    schemaVersion: template.schemaVersion,
    signatureMarkers: template.signatureMarkers,
    signatureRegions: template.signatureRegions,
    fieldAnchors: template.fieldAnchors,
    tableColumns: template.tableColumns,
    tableBounds: template.tableBounds,
    staticFields: template.staticFields,
  };
}

export function learnInvoiceTemplateCandidate({ observation, reviewedDraft, minimumOcrConfidence = 0.7 } = {}) {
  const normalized = normalizeOcrObservation(observation);
  const eligible = normalized.regions.filter((region) => region.confidence >= minimumOcrConfidence);
  const excludedIndexes = new Set();
  const uniqueScalarMatches = [];

  for (const fieldPath of SCALAR_FIELDS) {
    const value = fieldValue(reviewedDraft, fieldPath);
    const candidates = matchingRegions(eligible, value);
    if (candidates.length === 1) uniqueScalarMatches.push({ fieldPath, region: candidates[0] });
    for (const candidate of candidates) excludedIndexes.add(candidate.index);
  }

  const table = learnTableStructure(eligible, reviewedDraft, excludedIndexes, uniqueScalarMatches);
  const tableColumns = table.columns;
  const fieldAnchors = uniqueScalarMatches.map(({ fieldPath, region }) => learnedAnchor(fieldPath, region, eligible, excludedIndexes));
  const signatureRegions = [];
  const seenMarkers = new Set();
  for (const region of eligible) {
    const marker = stableMarker(region, excludedIndexes);
    if (!marker) continue;
    const digest = markerDigest(marker);
    if (seenMarkers.has(digest)) continue;
    seenMarkers.add(digest);
    signatureRegions.push({
      digest,
      centerX: round(region.box.x + region.box.width / 2),
      centerY: round(region.box.y + region.box.height / 2),
    });
    if (signatureRegions.length >= 24) break;
  }
  const signatureMarkers = signatureRegions.map((region) => region.digest);
  const template = {
    schemaVersion: 1,
    signatureMarkers,
    signatureRegions,
    fieldAnchors,
    tableColumns,
    tableBounds: table.bounds,
    staticFields: {
      documentType: reviewedDraft?.documentType?.value || "unknown",
      currency: reviewedDraft?.currency?.value || "UNKNOWN",
    },
    learningMetrics: {
      eligibleRegionCount: eligible.length,
      anchoredFieldCount: fieldAnchors.length,
      tableColumnCount: tableColumns.length,
    },
  };
  return {
    ...template,
    fingerprint: crypto.createHash("sha256").update(JSON.stringify(canonicalTemplatePayload(template))).digest("hex"),
  };
}

function observedMarkers(observation) {
  const normalized = normalizeOcrObservation(observation);
  return normalized.regions.flatMap((region) => {
    const marker = stableMarker(region, new Set());
    if (!marker) return [];
    return [{
      digest: markerDigest(marker),
      centerX: region.box.x + region.box.width / 2,
      centerY: region.box.y + region.box.height / 2,
    }];
  });
}

export function matchInvoiceTemplate(observation, template) {
  const expected = new Set(template?.signatureMarkers || []);
  const actualMarkers = observedMarkers(observation);
  const actual = new Set(actualMarkers.map((marker) => marker.digest));
  const intersection = [...expected].filter((marker) => actual.has(marker)).length;
  const union = new Set([...expected, ...actual]).size;
  const signatureScore = expected.size ? intersection / expected.size : 0;
  const jaccardScore = union ? intersection / union : 0;
  const geometrySamples = (template?.signatureRegions || []).flatMap((expectedRegion) => {
    const candidates = actualMarkers.filter((marker) => marker.digest === expectedRegion.digest);
    if (!candidates.length) return [];
    const distance = Math.min(...candidates.map((candidate) => Math.hypot(
      candidate.centerX - expectedRegion.centerX,
      candidate.centerY - expectedRegion.centerY,
    )));
    return [Math.max(0, 1 - (distance / 0.12))];
  });
  const geometryScore = geometrySamples.length
    ? geometrySamples.reduce((sum, value) => sum + value, 0) / geometrySamples.length
    : 0;
  const score = round((signatureScore * 0.55) + (jaccardScore * 0.15) + (geometryScore * 0.3));
  return {
    matched: expected.size >= 3 && intersection >= 3 && geometryScore >= 0.7 && score >= 0.72,
    score,
    geometryScore: round(geometryScore),
    matchedMarkers: intersection,
    expectedMarkers: expected.size,
  };
}

function boxDistance(left, right) {
  const leftX = left.x + left.width / 2;
  const leftY = left.y + left.height / 2;
  const rightX = right.x + right.width / 2;
  const rightY = right.y + right.height / 2;
  return Math.hypot(leftX - rightX, leftY - rightY);
}

export function extractTemplateFieldCandidates(observation, template, { maximumDistance = 0.08 } = {}) {
  const normalized = normalizeOcrObservation(observation);
  const fields = {};
  const warnings = [];
  for (const anchor of template?.fieldAnchors || []) {
    const candidates = normalized.regions
      .filter((region) => region.shape === anchor.valueShape && boxDistance(region.box, anchor.box) <= maximumDistance)
      .map((region) => ({
        text: region.text,
        confidence: round(region.confidence * Math.max(0, 1 - (boxDistance(region.box, anchor.box) / maximumDistance))),
        box: region.box,
      }))
      .sort((left, right) => right.confidence - left.confidence);
    if (!candidates.length) {
      warnings.push(`${anchor.fieldPath}: anchor not found`);
      continue;
    }
    if (candidates[1] && candidates[0].confidence - candidates[1].confidence < 0.1) {
      warnings.push(`${anchor.fieldPath}: ambiguous anchor`);
      continue;
    }
    fields[anchor.fieldPath] = candidates[0];
  }
  return { fields, warnings };
}

function columnTolerance(columns, index) {
  const distances = [];
  if (columns[index - 1]) distances.push(Math.abs(columns[index].centerX - columns[index - 1].centerX));
  if (columns[index + 1]) distances.push(Math.abs(columns[index + 1].centerX - columns[index].centerX));
  return Math.min(0.07, Math.max(0.025, (distances.length ? Math.min(...distances) : 0.1) * 0.42));
}

export function extractTemplateLineCandidates(observation, template) {
  const normalized = normalizeOcrObservation(observation);
  const columns = [...(template?.tableColumns || [])].sort((left, right) => left.centerX - right.centerX);
  const bounds = template?.tableBounds;
  if (!bounds || !columns.length) return { lines: [], warnings: ["Line table structure is unavailable."] };
  const cells = normalized.regions.flatMap((region) => {
    const y = centerY(region);
    if (y < bounds.topY || y > bounds.bottomY) return [];
    const x = region.box.x + region.box.width / 2;
    const ranked = columns
      .map((column, index) => ({ column, distance: Math.abs(x - column.centerX), tolerance: columnTolerance(columns, index) }))
      .sort((left, right) => left.distance - right.distance);
    if (!ranked[0] || ranked[0].distance > ranked[0].tolerance) return [];
    return [{ fieldName: ranked[0].column.fieldName, region, y }];
  }).sort((left, right) => left.y - right.y);

  const rows = [];
  for (const cell of cells) {
    let row = rows.find((candidate) => Math.abs(candidate.centerY - cell.y) <= bounds.rowTolerance);
    if (!row) {
      row = { centerY: cell.y, cells: [] };
      rows.push(row);
    }
    row.cells.push(cell);
    row.centerY = median(row.cells.map((candidate) => candidate.y));
  }
  const lines = rows.flatMap((row, index) => {
    const values = {};
    for (const fieldName of LINE_FIELDS) {
      const candidates = row.cells
        .filter((cell) => cell.fieldName === fieldName)
        .sort((left, right) => right.region.confidence - left.region.confidence);
      if (candidates[0]) values[fieldName] = candidates[0].region;
    }
    if (!values.partNumber && !values.description) return [];
    return [{ id: `line-${index + 1}`, values }];
  });
  return { lines, warnings: lines.length ? [] : ["No line rows matched the learned table."] };
}

function parsedNumber(value) {
  const normalized = String(value ?? "").trim().replace(/[$,\s]/g, "").replace(/\(([^)]+)\)/, "-$1").replace(/-$/, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function evidenceField(value, region, fallbackConfidence = 0) {
  return {
    value,
    confidence: region ? Math.max(0, Math.min(99, Math.round(region.confidence * 100))) : fallbackConfidence,
    evidence: region ? `Local OCR near x=${round(region.box.x)}, y=${round(region.box.y)}` : "Not found by local OCR",
  };
}

export function buildInvoiceDraftFromTemplate({ observation, template } = {}) {
  const scalar = extractTemplateFieldCandidates(observation, template);
  const table = extractTemplateLineCandidates(observation, template);
  const textField = (name) => evidenceField(scalar.fields[name]?.text || "", scalar.fields[name]);
  const numberField = (name) => evidenceField(parsedNumber(scalar.fields[name]?.text), scalar.fields[name]);
  const lines = table.lines.map((line) => {
    const text = (name) => evidenceField(line.values[name]?.text || "", line.values[name]);
    const number = (name) => evidenceField(parsedNumber(line.values[name]?.text), line.values[name]);
    return {
      id: line.id,
      partNumber: text("partNumber"),
      description: text("description"),
      quantity: number("quantity"),
      unitOfMeasure: text("unitOfMeasure"),
      unitPrice: number("unitPrice"),
      lineTotal: number("lineTotal"),
    };
  });
  const staticDocumentType = ["invoice", "credit_memo", "unknown"].includes(template?.staticFields?.documentType)
    ? template.staticFields.documentType
    : "unknown";
  return {
    documentType: evidenceField(staticDocumentType, null, 80),
    vendorName: textField("vendorName"),
    vendorAccount: textField("vendorAccount"),
    invoiceNumber: textField("invoiceNumber"),
    invoiceDate: textField("invoiceDate"),
    purchaseOrderNumber: textField("purchaseOrderNumber"),
    currency: evidenceField(String(template?.staticFields?.currency || "UNKNOWN"), null, 80),
    subtotal: numberField("subtotal"),
    tax: numberField("tax"),
    shipping: numberField("shipping"),
    total: numberField("total"),
    lines,
    warnings: ["Extracted locally from a learned layout; review required.", ...scalar.warnings, ...table.warnings],
  };
}

export function localTemplateDraftIsUsable(draft) {
  return Boolean(
    draft?.invoiceNumber?.value
    && draft?.total?.value !== null
    && draft?.lines?.length
    && draft.lines.every((line) => (line.partNumber.value || line.description.value) && line.quantity.value !== null),
  );
}
