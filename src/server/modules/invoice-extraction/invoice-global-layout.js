import crypto from "node:crypto";

export const GLOBAL_LAYOUT_SCHEMA_VERSION = 1;
export const GLOBAL_LAYOUT_MAX_CONFIDENCE = 89;
export const GLOBAL_LAYOUT_PRIVACY_SCANNER_VERSION = "global-layout-privacy-v1";

const COORDINATE_BINS = 20;
const MAX_MARKERS = 12;
const MAX_ANCHORS = 10;
const MAX_COLUMNS = 6;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const FIELD_PATHS = new Set([
  "invoiceNumber", "invoiceDate", "subtotal", "tax", "shipping", "total",
  "lines.partNumber", "lines.description", "lines.quantity", "lines.unitOfMeasure",
  "lines.unitPrice", "lines.lineTotal",
]);
const VALUE_SHAPES = new Set(["DATE", "MONEY", "INTEGER", "DECIMAL", "CODE", "TEXT"]);
const GENERIC_LABELS = new Map([
  ["invoice number", "invoice number"], ["invoice no", "invoice number"], ["invoice", "invoice"],
  ["date", "date"], ["invoice date", "date"], ["subtotal", "subtotal"], ["sub total", "subtotal"],
  ["tax", "tax"], ["sales tax", "tax"], ["shipping", "shipping"], ["freight", "shipping"],
  ["total", "total"], ["invoice total", "total"], ["amount due", "total"],
  ["item", "item"], ["part number", "part number"], ["part no", "part number"],
  ["description", "description"], ["quantity", "quantity"], ["qty", "quantity"],
  ["unit", "unit"], ["unit price", "unit price"], ["price", "unit price"],
  ["line total", "line total"], ["extended price", "line total"], ["extd price", "line total"],
]);

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[\s\u00a0]+/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function comparableText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = String(value).trim();
  const numeric = text.replace(/[$,\s]/g, "").replace(/^\((.+)\)$/, "-$1");
  return /^-?\d+(?:\.\d+)?$/.test(numeric) ? String(Number(numeric)) : normalizeText(text);
}

function valueShape(value) {
  const text = String(value ?? "").trim();
  if (/^(?:\d{1,4}[-/.]){2}\d{1,4}$/.test(text)) return "DATE";
  if (/^[-+]?\s*[$€£]?\s*\d[\d,]*\.\d{2}\s*-?$/.test(text)) return "MONEY";
  if (/^[-+]?\d+$/.test(text)) return "INTEGER";
  if (/^[-+]?\d+(?:\.\d+)?$/.test(text.replace(/[,\s]/g, ""))) return "DECIMAL";
  if (/^(?=.*\d)[a-z0-9 ./_-]+$/i.test(text)) return "CODE";
  return "TEXT";
}

function keyBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const decoded = Buffer.from(text, "base64");
    return decoded.length >= 32 && decoded.toString("base64").replace(/=+$/, "") === text.replace(/=+$/, "")
      ? decoded : Buffer.from(text, "utf8");
  } catch {
    return Buffer.from(text, "utf8");
  }
}

export function configuredGlobalLayoutKeyrings({ activeVersion, serializedKeys } = {}) {
  const version = String(activeVersion || "").trim();
  let keys;
  try {
    keys = typeof serializedKeys === "string" ? JSON.parse(serializedKeys) : serializedKeys;
  } catch {
    return [];
  }
  if (!/^[a-z0-9_-]{1,40}$/.test(version) || !keys || typeof keys !== "object" || Array.isArray(keys)
    || !Object.hasOwn(keys, version)) return [];
  const versions = [version, ...Object.keys(keys).filter((item) => item !== version).sort()].slice(0, 4);
  try {
    for (const item of versions) {
      if (!/^[a-z0-9_-]{1,40}$/.test(item) || !keyBytes(keys[item]) || keyBytes(keys[item]).length < 32) return [];
    }
  } catch {
    return [];
  }
  return versions.map((item) => Object.freeze({ version: item, keys }));
}

export function invoiceLayoutHmac(label, { version, keys } = {}) {
  const canonical = GENERIC_LABELS.get(normalizeText(label));
  const key = keyBytes(keys?.[version]);
  if (!canonical || !version || !key || key.length < 32) {
    throw new Error("invoice_global_layout_hmac_unavailable");
  }
  return crypto.createHmac("sha256", key).update(canonical).digest("hex");
}

function bin(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error("invoice_global_layout_invalid_coordinate");
  return Math.min(COORDINATE_BINS, Math.max(0, Math.round(numeric * COORDINATE_BINS)));
}

function bounds(region, width, height) {
  const polygon = Array.isArray(region?.polygon) ? region.polygon : null;
  if (polygon?.length >= 3) {
    const xs = polygon.map((point) => Number(point?.[0]));
    const ys = polygon.map((point) => Number(point?.[1]));
    return {
      x: Math.min(...xs) / width, y: Math.min(...ys) / height,
      w: (Math.max(...xs) - Math.min(...xs)) / width,
      h: (Math.max(...ys) - Math.min(...ys)) / height,
    };
  }
  const x = Number(region?.x); const y = Number(region?.y);
  const w = Number(region?.width); const h = Number(region?.height);
  if (![x, y, w, h].every(Number.isFinite)) throw new Error("invoice_global_layout_invalid_coordinate");
  return {
    x: x > 1 || w > 1 ? x / width : x,
    y: y > 1 || h > 1 ? y / height : y,
    w: x > 1 || w > 1 ? w / width : w,
    h: y > 1 || h > 1 ? h / height : h,
  };
}

function normalizedObservation(observation) {
  const width = Number(observation?.width);
  const height = Number(observation?.height);
  if (!(width > 0 && height > 0)) throw new Error("invoice_global_layout_invalid_page");
  const regions = (observation?.regions || []).slice(0, 500).flatMap((region, index) => {
    const text = String(region?.text || "").trim();
    if (!text) return [];
    const box = bounds(region, width, height);
    if (box.w <= 0 || box.h <= 0 || box.x < 0 || box.y < 0 || box.x + box.w > 1.02 || box.y + box.h > 1.02) return [];
    return [{ index, text, normalized: normalizeText(text), shape: valueShape(text), box }];
  });
  const ratio = width / height;
  return { pageShape: ratio < 0.9 ? "portrait" : ratio > 1.1 ? "landscape" : "square", regions };
}

function reviewedScalarValues(reviewedDraft) {
  return ["invoiceNumber", "invoiceDate", "subtotal", "tax", "shipping", "total"].flatMap((fieldPath) => {
    const value = reviewedDraft?.[fieldPath]?.value;
    return comparableText(value) ? [{ fieldPath, value }] : [];
  });
}

function reviewedLineValues(reviewedDraft) {
  const output = new Map();
  for (const field of ["partNumber", "description", "quantity", "unitOfMeasure", "unitPrice", "lineTotal"]) {
    const values = (reviewedDraft?.lines || []).map((line) => line?.[field]?.value).filter((value) => comparableText(value));
    if (values.length) output.set(`lines.${field}`, values);
  }
  return output;
}

function labelMarkers(regions, keyring) {
  const candidates = regions.flatMap((region) => {
    const canonical = GENERIC_LABELS.get(region.normalized);
    if (!canonical) return [];
    return [{
      markerHmac: invoiceLayoutHmac(canonical, keyring),
      xBin: bin(region.box.x + region.box.w / 2),
      yBin: bin(region.box.y + region.box.h / 2),
    }];
  }).sort((a, b) => a.markerHmac.localeCompare(b.markerHmac) || a.yBin - b.yBin || a.xBin - b.xBin);
  const digests = new Set();
  const coordinates = new Set();
  return candidates.filter((marker) => {
    const coordinate = `${marker.xBin}:${marker.yBin}`;
    if (digests.has(marker.markerHmac) || coordinates.has(coordinate)) return false;
    digests.add(marker.markerHmac);
    coordinates.add(coordinate);
    return true;
  }).slice(0, MAX_MARKERS);
}

function nearestLabel(regions, target) {
  const targetY = target.box.y + target.box.h / 2;
  return regions.filter((region) => GENERIC_LABELS.has(region.normalized))
    .filter((region) => region.box.x + region.box.w <= target.box.x + 0.03
      && Math.abs((region.box.y + region.box.h / 2) - targetY) <= 0.06)
    .sort((left, right) => Math.abs((left.box.x + left.box.w) - target.box.x)
      - Math.abs((right.box.x + right.box.w) - target.box.x))[0] || null;
}

function fieldAnchors(regions, reviewedDraft, keyring) {
  const anchors = [];
  for (const { fieldPath, value } of reviewedScalarValues(reviewedDraft)) {
    const matches = regions.filter((region) => comparableText(region.text) === comparableText(value));
    if (matches.length !== 1) continue;
    const target = matches[0];
    const label = nearestLabel(regions, target);
    if (!label) continue;
    anchors.push({
      fieldPath, xBin: bin(target.box.x), yBin: bin(target.box.y),
      wBin: bin(target.box.w), hBin: bin(target.box.h), valueShape: target.shape,
      labelHmacs: [invoiceLayoutHmac(label.normalized, keyring)],
    });
  }
  return anchors.sort((a, b) => a.fieldPath.localeCompare(b.fieldPath)).slice(0, MAX_ANCHORS);
}

function tableColumns(regions, reviewedDraft) {
  const columns = [];
  for (const [fieldPath, values] of reviewedLineValues(reviewedDraft)) {
    const matches = regions.filter((region) => values.some((value) => comparableText(region.text) === comparableText(value)));
    if (!matches.length) continue;
    const centers = matches.map((region) => region.box.x + region.box.w / 2).sort((a, b) => a - b);
    const center = centers[Math.floor(centers.length / 2)];
    columns.push({ fieldPath, xBin: bin(center), valueShape: matches[0].shape });
  }
  return columns.sort((a, b) => a.xBin - b.xBin || a.fieldPath.localeCompare(b.fieldPath)).slice(0, MAX_COLUMNS);
}

export function canonicalGlobalLayoutPayload(payload) {
  const expectedKeys = ["schemaVersion", "hmacKeyVersion", "pageShape", "signatureRegions", "fieldAnchors", "tableColumns"];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || Object.keys(payload).sort().join("|") !== [...expectedKeys].sort().join("|")) {
    throw new Error("invoice_global_layout_unknown_field");
  }
  if (payload.schemaVersion !== GLOBAL_LAYOUT_SCHEMA_VERSION || !/^[a-z0-9_-]{1,40}$/.test(payload.hmacKeyVersion || "")
    || !["portrait", "landscape", "square"].includes(payload.pageShape)) {
    throw new Error("invoice_global_layout_incompatible_schema");
  }
  if (!Array.isArray(payload.signatureRegions) || payload.signatureRegions.length < 3 || payload.signatureRegions.length > MAX_MARKERS
    || !Array.isArray(payload.fieldAnchors) || payload.fieldAnchors.length > MAX_ANCHORS
    || !Array.isArray(payload.tableColumns) || payload.tableColumns.length > MAX_COLUMNS) {
    throw new Error("invoice_global_layout_cardinality_rejected");
  }
  const integerBin = (value) => Number.isInteger(value) && value >= 0 && value <= COORDINATE_BINS;
  for (const marker of payload.signatureRegions) {
    if (Object.keys(marker).sort().join("|") !== "markerHmac|xBin|yBin" || !DIGEST_PATTERN.test(marker.markerHmac)
      || !integerBin(marker.xBin) || !integerBin(marker.yBin)) throw new Error("invoice_global_layout_invalid_marker");
  }
  for (const anchor of payload.fieldAnchors) {
    const keys = ["fieldPath", "hBin", "labelHmacs", "valueShape", "wBin", "xBin", "yBin"];
    if (Object.keys(anchor).sort().join("|") !== keys.sort().join("|") || !FIELD_PATHS.has(anchor.fieldPath)
      || !VALUE_SHAPES.has(anchor.valueShape) || ![anchor.xBin, anchor.yBin, anchor.wBin, anchor.hBin].every(integerBin)
      || !Array.isArray(anchor.labelHmacs) || anchor.labelHmacs.length < 1 || anchor.labelHmacs.length > 2
      || !anchor.labelHmacs.every((digest) => DIGEST_PATTERN.test(digest))) throw new Error("invoice_global_layout_invalid_anchor");
  }
  for (const column of payload.tableColumns) {
    if (Object.keys(column).sort().join("|") !== "fieldPath|valueShape|xBin" || !FIELD_PATHS.has(column.fieldPath)
      || !column.fieldPath.startsWith("lines.") || !VALUE_SHAPES.has(column.valueShape) || !integerBin(column.xBin)) {
      throw new Error("invoice_global_layout_invalid_column");
    }
  }
  const canonical = {
    schemaVersion: payload.schemaVersion,
    hmacKeyVersion: payload.hmacKeyVersion,
    pageShape: payload.pageShape,
    signatureRegions: [...payload.signatureRegions].sort((a, b) => a.markerHmac.localeCompare(b.markerHmac) || a.yBin - b.yBin || a.xBin - b.xBin),
    fieldAnchors: [...payload.fieldAnchors].map((anchor) => ({ ...anchor, labelHmacs: [...anchor.labelHmacs].sort() }))
      .sort((a, b) => a.fieldPath.localeCompare(b.fieldPath)),
    tableColumns: [...payload.tableColumns].sort((a, b) => a.xBin - b.xBin || a.fieldPath.localeCompare(b.fieldPath)),
  };
  const serialized = JSON.stringify(canonical);
  if (Buffer.byteLength(serialized) > 32768) throw new Error("invoice_global_layout_payload_too_large");
  return canonical;
}

export function globalLayoutFingerprint(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalGlobalLayoutPayload(payload))).digest("hex");
}

// Global artifacts use a tiny, code-reviewed grammar. Observed coordinates may
// select this grammar, but they are never persisted. New grammars require a
// code/schema release, which keeps attacker-selected geometry out of the
// cross-tenant channel while unsupported layouts remain tenant-local.
function reviewedGlobalLayoutGrammar(keyring) {
  const marker = (label, xBin, yBin) => ({ markerHmac: invoiceLayoutHmac(label, keyring), xBin, yBin });
  return canonicalGlobalLayoutPayload({
    schemaVersion: GLOBAL_LAYOUT_SCHEMA_VERSION,
    hmacKeyVersion: keyring?.version,
    pageShape: "portrait",
    signatureRegions: [
      marker("invoice number", 13, 2),
      marker("description", 8, 7),
      marker("quantity", 14, 7),
      marker("total", 15, 15),
    ],
    fieldAnchors: [
      { fieldPath: "invoiceNumber", xBin: 15, yBin: 2, wBin: 3, hBin: 1, valueShape: "CODE", labelHmacs: [invoiceLayoutHmac("invoice number", keyring)] },
      { fieldPath: "total", xBin: 17, yBin: 15, wBin: 2, hBin: 1, valueShape: "MONEY", labelHmacs: [invoiceLayoutHmac("total", keyring)] },
    ],
    tableColumns: [
      { fieldPath: "lines.partNumber", xBin: 4, valueShape: "CODE" },
      { fieldPath: "lines.description", xBin: 9, valueShape: "TEXT" },
      { fieldPath: "lines.quantity", xBin: 13, valueShape: "INTEGER" },
      { fieldPath: "lines.unitPrice", xBin: 16, valueShape: "MONEY" },
      { fieldPath: "lines.lineTotal", xBin: 18, valueShape: "MONEY" },
    ],
  });
}

export function scanGlobalLayoutPayload(payload, keyring) {
  const canonical = canonicalGlobalLayoutPayload(payload);
  if (canonical.hmacKeyVersion !== keyring?.version) throw new Error("invoice_global_layout_privacy_key_mismatch");
  const allowedDigests = new Set([...new Set(GENERIC_LABELS.values())]
    .map((label) => invoiceLayoutHmac(label, keyring)));
  const markerDigests = canonical.signatureRegions.map((marker) => marker.markerHmac);
  if (new Set(markerDigests).size !== markerDigests.length) {
    throw new Error("invoice_global_layout_repeated_marker_rejected");
  }
  if (markerDigests.some((digest) => !allowedDigests.has(digest))) {
    throw new Error("invoice_global_layout_unrecognized_marker_rejected");
  }
  const coordinatePairs = canonical.signatureRegions.map((marker) => `${marker.xBin}:${marker.yBin}`);
  if (new Set(coordinatePairs).size !== coordinatePairs.length
    || new Set(canonical.signatureRegions.map((marker) => marker.xBin)).size > 8
    || new Set(canonical.signatureRegions.map((marker) => marker.yBin)).size > 8) {
    throw new Error("invoice_global_layout_geometry_entropy_rejected");
  }
  const anchorPaths = canonical.fieldAnchors.map((anchor) => anchor.fieldPath);
  if (new Set(anchorPaths).size !== anchorPaths.length
    || canonical.fieldAnchors.some((anchor) => anchor.labelHmacs.some((digest) => !allowedDigests.has(digest)))) {
    throw new Error("invoice_global_layout_anchor_privacy_rejected");
  }
  const grammar = reviewedGlobalLayoutGrammar(keyring);
  if (JSON.stringify(canonical) !== JSON.stringify(grammar)) {
    throw new Error("invoice_global_layout_unreviewed_grammar_rejected");
  }
  const serialized = JSON.stringify(canonical);
  return Object.freeze({
    scannerVersion: GLOBAL_LAYOUT_PRIVACY_SCANNER_VERSION,
    scanDigest: crypto.createHash("sha256").update(`${GLOBAL_LAYOUT_PRIVACY_SCANNER_VERSION}\n${serialized}`).digest("hex"),
    markerCount: markerDigests.length,
    coordinateBinCount: COORDINATE_BINS,
  });
}

export function buildGlobalInvoiceLayoutContribution({ observation, reviewedDraft, keyring }) {
  normalizedObservation(observation);
  const payload = reviewedGlobalLayoutGrammar(keyring);
  if (!matchGlobalInvoiceLayout(observation, payload, keyring).matched) {
    throw new Error("invoice_global_layout_unsupported_grammar");
  }
  const privacyScan = scanGlobalLayoutPayload(payload, keyring);
  return {
    payload,
    structuralFingerprint: globalLayoutFingerprint(payload),
    markerDigests: [...new Set(payload.signatureRegions.map((marker) => marker.markerHmac))].sort(),
    privacyScan,
  };
}

export function replayGlobalLayoutEvidence({ payload, observation, reviewedDraft, negativeObservations = [], keyring }) {
  const canonical = canonicalGlobalLayoutPayload(payload);
  scanGlobalLayoutPayload(canonical, keyring);
  const normalized = normalizedObservation(observation);
  const positive = matchGlobalInvoiceLayout(observation, canonical, keyring);
  let applicableCriticalFields = 0;
  let correctCriticalFields = 0;
  for (const anchor of canonical.fieldAnchors.filter((item) => !item.fieldPath.startsWith("lines."))) {
    const reviewed = reviewedDraft?.[anchor.fieldPath]?.value;
    if (!comparableText(reviewed)) continue;
    applicableCriticalFields += 1;
    const matches = normalized.regions.filter((region) => comparableText(region.text) === comparableText(reviewed));
    if (matches.length !== 1) continue;
    const target = matches[0];
    if (Math.abs(bin(target.box.x) - anchor.xBin) <= 2 && Math.abs(bin(target.box.y) - anchor.yBin) <= 2) {
      correctCriticalFields += 1;
    }
  }
  const negativeMatches = negativeObservations.map((negative) => matchGlobalInvoiceLayout(negative, canonical, keyring).matched);
  const lines = reviewedDraft?.lines || [];
  const lineTotals = lines.map((line) => Number(line?.lineTotal?.value));
  const subtotal = Number(reviewedDraft?.subtotal?.value);
  const totalsApplicable = lineTotals.length > 0 && lineTotals.every(Number.isFinite) && Number.isFinite(subtotal);
  const totalsReconcile = totalsApplicable
    && Math.abs(lineTotals.reduce((sum, value) => sum + value, 0) - subtotal) <= 0.02;
  return Object.freeze({
    evaluatorVersion: "global-layout-replay-v1",
    positiveMatched: positive.matched,
    applicableCriticalFields,
    correctCriticalFields,
    totalsApplicable,
    totalsReconcile,
    explicitNegativeCount: negativeMatches.length,
    falsePositiveCount: negativeMatches.filter(Boolean).length,
  });
}

export function globalObservationMarkerDigests(observation, keyring) {
  const normalized = normalizedObservation(observation);
  return [...new Set(labelMarkers(normalized.regions, keyring).map((marker) => marker.markerHmac))].sort();
}

export function matchGlobalInvoiceLayout(observation, payload, keyring) {
  const template = canonicalGlobalLayoutPayload(payload);
  if (template.hmacKeyVersion !== keyring?.version) throw new Error("invoice_global_layout_hmac_version_mismatch");
  const actual = labelMarkers(normalizedObservation(observation).regions, keyring);
  const actualDigests = new Set(actual.map((marker) => marker.markerHmac));
  const expectedDigests = new Set(template.signatureRegions.map((marker) => marker.markerHmac));
  const matchedMarkers = [...expectedDigests].filter((digest) => actualDigests.has(digest)).length;
  const geometrySamples = template.signatureRegions.flatMap((expected) => {
    const candidates = actual.filter((candidate) => candidate.markerHmac === expected.markerHmac);
    if (!candidates.length) return [];
    const distance = Math.min(...candidates.map((candidate) => Math.hypot(
      candidate.xBin - expected.xBin,
      candidate.yBin - expected.yBin,
    )));
    return [Math.max(0, 1 - (distance / 6))];
  });
  const signatureScore = expectedDigests.size ? matchedMarkers / expectedDigests.size : 0;
  const geometryScore = geometrySamples.length
    ? geometrySamples.reduce((sum, value) => sum + value, 0) / geometrySamples.length
    : 0;
  const score = (signatureScore * 0.7) + (geometryScore * 0.3);
  return {
    matched: expectedDigests.size >= 3 && matchedMarkers >= 3 && signatureScore >= 0.6 && geometryScore >= 0.7,
    score: Math.round(score * 10_000) / 10_000,
    signatureScore: Math.round(signatureScore * 10_000) / 10_000,
    geometryScore: Math.round(geometryScore * 10_000) / 10_000,
    matchedMarkers,
    expectedMarkers: expectedDigests.size,
  };
}

export function globalLayoutAsLocalTemplate(payload) {
  const template = canonicalGlobalLayoutPayload(payload);
  const shape = (value) => ({
    DATE: "date",
    MONEY: "number",
    INTEGER: "number",
    DECIMAL: "number",
    CODE: "identifier",
    TEXT: "text",
  })[value];
  return {
    schemaVersion: template.schemaVersion,
    fieldAnchors: template.fieldAnchors
      .filter((anchor) => !anchor.fieldPath.startsWith("lines."))
      .map((anchor) => ({
        fieldPath: anchor.fieldPath,
        box: {
          x: anchor.xBin / COORDINATE_BINS,
          y: anchor.yBin / COORDINATE_BINS,
          width: Math.max(1, anchor.wBin) / COORDINATE_BINS,
          height: Math.max(1, anchor.hBin) / COORDINATE_BINS,
        },
        valueShape: shape(anchor.valueShape),
        labels: [],
      })),
    tableColumns: template.tableColumns.map((column) => ({
      fieldName: column.fieldPath.replace(/^lines\./, ""),
      centerX: column.xBin / COORDINATE_BINS,
      valueShape: shape(column.valueShape),
    })),
    tableBounds: null,
    staticFields: { documentType: "unknown", currency: "UNKNOWN" },
  };
}

export function capGlobalTemplateConfidence(draft) {
  const capField = (field) => field && typeof field === "object" && Object.hasOwn(field, "confidence")
    ? { ...field, confidence: Math.min(GLOBAL_LAYOUT_MAX_CONFIDENCE, Number(field.confidence) || 0) } : field;
  const scalar = Object.fromEntries(Object.entries(draft || {}).map(([key, value]) => [key, key === "lines" || key === "warnings" ? value : capField(value)]));
  return {
    ...scalar,
    lines: (draft?.lines || []).map((line) => Object.fromEntries(Object.entries(line).map(([key, value]) => [key, capField(value)]))),
    warnings: [...new Set([...(draft?.warnings || []), "Global layout evidence requires local review."])],
  };
}
