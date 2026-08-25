import { normalizeOcrObservation } from "./invoice-template-learning.js";

const HEADER_PATTERNS = {
  partNumber: /^(?:item|item no|part|part no|part number|sales part number)$/,
  description: /description/,
  quantity: /^(?:qty|quantity|qty ship|qty shipped|sales qty)/,
  unitOfMeasure: /^(?:uom|unit|unit of measure)$/,
  unitPrice: /^(?:unit price|unit rate|rate|net)$/,
  lineTotal: /^(?:extd price|extended price|extension|amount)$/,
};

function normalized(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9#$./]+/g, " ").trim();
}

function numberValue(value) {
  let text = String(value ?? "").trim().replace(/^S(?=\d)/i, "$").replace(/[$,\s]/g, "").replace(/\(([^)]+)\)/, "-$1").replace(/-$/, "");
  if (/^-?\.\d+$/.test(text)) text = text.replace(".", "0.");
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function center(region, axis) {
  return region.box[axis] + region.box[axis === "x" ? "width" : "height"] / 2;
}

function field(value, region = null, confidence = 0, evidence = "Not found by local OCR") {
  return {
    value,
    confidence: region ? Math.max(0, Math.min(95, Math.round(region.confidence * 100))) : confidence,
    evidence: region ? `Local OCR near x=${region.box.x}, y=${region.box.y}` : evidence,
  };
}

function groupRows(regions, tolerance = 0.018) {
  const rows = [];
  for (const region of [...regions].sort((left, right) => center(left, "y") - center(right, "y"))) {
    const y = center(region, "y");
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= tolerance);
    if (!row) {
      row = { y, regions: [] };
      rows.push(row);
    }
    row.regions.push(region);
    row.y = row.regions.reduce((sum, item) => sum + center(item, "y"), 0) / row.regions.length;
  }
  return rows.map((row) => ({ ...row, regions: row.regions.sort((left, right) => center(left, "x") - center(right, "x")) }));
}

function valueRightOfLabel(regions, labelPattern, { numeric = false } = {}) {
  const labels = regions.filter((region) => labelPattern.test(normalized(region.text)));
  for (const label of labels.sort((left, right) => center(right, "y") - center(left, "y"))) {
    const rawLabel = String(label.text ?? "").trim();
    const separatorIndex = rawLabel.search(/[:#]/);
    const separatedInline = separatorIndex >= 0 ? rawLabel.slice(separatorIndex + 1).trim() : "";
    const inline = separatedInline || normalized(rawLabel).replace(labelPattern, "").replace(/^[:# -]+/, "").trim();
    if (inline && (!numeric || numberValue(inline) !== null)) return { text: inline, region: label };
    const labelY = center(label, "y");
    const candidates = regions.filter((region) => {
      if (region.index === label.index || region.box.x < label.box.x + label.box.width - 0.01) return false;
      if (Math.abs(center(region, "y") - labelY) > Math.max(0.012, label.box.height * 1.5)) return false;
      return !numeric || numberValue(region.text) !== null;
    }).sort((left, right) => {
      const verticalDifference = Math.abs(center(left, "y") - labelY) - Math.abs(center(right, "y") - labelY);
      return verticalDifference || center(left, "x") - center(right, "x");
    });
    if (candidates[0]) return { text: candidates[0].text, region: candidates[0] };
  }
  return null;
}

function vendorCandidate(regions) {
  const excluded = /invoice|estimate|customer|purchaser|deliver|bill to|date|terms|purchase order|picked up|page|remit|subtotal|total|description/;
  return regions
    .filter((region) => center(region, "y") <= 0.28 && /[a-z]/i.test(region.text) && !/\d/.test(region.text)
      && !excluded.test(normalized(region.text)) && !/(?:https?:\/\/|www\.|\.[a-z]{2,}\b)/i.test(region.text))
    .map((region) => {
      const text = normalized(region.text);
      const businessNameSignal = /\b(?:truck|freightliner|centers?|equipment|parts|automotive|volvo|mack|rush|velocity)\b/.test(text) ? 1.5 : 0;
      const relationshipFragmentPenalty = /^(?:a )?(?:division|part|member|on) of\b/.test(text) ? 2 : 0;
      return { region, score: (region.confidence * 3) + Math.min(1.5, region.text.length / 20) + businessNameSignal - relationshipFragmentPenalty - (center(region, "y") * 2) };
    })
    .sort((left, right) => right.score - left.score)[0]?.region || null;
}

function headerColumns(rows) {
  const candidates = rows.map((row) => {
    const columns = [];
    for (const region of row.regions) {
      for (const [fieldName, pattern] of Object.entries(HEADER_PATTERNS)) {
        if (pattern.test(normalized(region.text))) columns.push({ fieldName, centerX: center(region, "x") });
      }
    }
    return { row, columns };
  }).filter(({ columns }) => new Set(columns.map((column) => column.fieldName)).size >= 2)
    .sort((left, right) => right.columns.length - left.columns.length);
  return candidates[0] || null;
}

function nearestColumn(columns, region) {
  const x = center(region, "x");
  const ranked = columns.map((column) => ({ ...column, distance: Math.abs(x - column.centerX) }))
    .sort((left, right) => left.distance - right.distance);
  return ranked[0]?.distance <= 0.13 ? ranked[0] : null;
}

function genericLines(rows, regions) {
  const header = headerColumns(rows);
  if (!header) return fallbackLineIslands(rows, regions);
  const totalLabels = regions.filter((region) => /^(?:sub ?total|total|please pay)(?: usd)?$/.test(normalized(region.text)) && center(region, "y") > header.row.y);
  const bottomY = totalLabels.length ? Math.min(...totalLabels.map((region) => center(region, "y"))) - 0.01 : Math.min(0.95, header.row.y + 0.45);
  const columns = [...new Map(header.columns.map((column) => [column.fieldName, column])).values()];
  return rows.filter((row) => row.y > header.row.y + 0.012 && row.y < bottomY).flatMap((row, index) => {
    const values = {};
    for (const region of row.regions) {
      const column = nearestColumn(columns, region);
      if (!column) continue;
      if (!values[column.fieldName] || region.confidence > values[column.fieldName].confidence) values[column.fieldName] = region;
    }
    if (!values.partNumber && !values.description) return [];
    if (!values.quantity && columns.some((column) => column.fieldName === "partNumber")) {
      const partX = columns.find((column) => column.fieldName === "partNumber").centerX;
      values.quantity = row.regions
        .filter((region) => numberValue(region.text) !== null && center(region, "x") < partX - 0.03)
        .sort((left, right) => center(right, "x") - center(left, "x"))[0];
    }
    const text = (name) => field(values[name]?.text || "", values[name]);
    const number = (name) => field(numberValue(values[name]?.text), values[name]);
    return [{
      id: `line-${index + 1}`,
      partNumber: text("partNumber"),
      description: text("description"),
      quantity: number("quantity"),
      unitOfMeasure: text("unitOfMeasure"),
      unitPrice: number("unitPrice"),
      lineTotal: number("lineTotal"),
    }];
  });
}

function fallbackLineIslands(rows, regions) {
  const subtotalY = regions
    .filter((region) => /^sub ?total$/.test(normalized(region.text)))
    .map((region) => center(region, "y"))
    .sort((left, right) => left - right)[0] || 0.8;
  return rows.filter((row) => row.y >= 0.24 && row.y < subtotalY - 0.015).flatMap((row, index) => {
    const candidates = row.regions.filter((region) => region.box.x >= 0.08 && region.box.x <= 0.82 && region.text.length <= 120);
    const part = candidates.find((region) => region.box.x >= 0.15 && /\d/.test(region.text) && /[a-z]/i.test(region.text)
      && normalized(region.text).length >= 5 && normalized(region.text).length <= 35
      && !/^p?\s*\d{3}\D?\d{3}[- ]?\d{4}$/i.test(region.text.trim())
      && !/[a-z]{2}\s*\d{5}(?:-\d{4})?$/i.test(region.text.trim())
      && !/\bstreet\b|\bavenue\b|\broad\b|\bave\b|\bblvd\b/i.test(region.text));
    const description = candidates.find((region) => region.index !== part?.index && /[a-z]{3}/i.test(region.text)
      && !/delivery|invoice|customer|purchaser|\bstreet\b|\bavenue\b|\broad\b|\bave\b/i.test(region.text)
      && center(region, "x") >= center(part || region, "x") + 0.06);
    if (!part || !description) return [];
    const quantity = candidates
      .filter((region) => center(region, "x") < center(part, "x") - 0.03 && numberValue(region.text) !== null)
      .sort((left, right) => center(right, "x") - center(left, "x"))[0];
    return [{
      id: `line-${index + 1}`,
      partNumber: field(part.text, part),
      description: field(description.text, description),
      quantity: field(numberValue(quantity?.text), quantity),
      unitOfMeasure: field(""),
      unitPrice: field(null),
      lineTotal: field(null),
    }];
  });
}

function totalFallback(regions, subtotal) {
  if (!subtotal?.region) return null;
  const startY = center(subtotal.region, "y");
  return regions
    .filter((region) => center(region, "x") > center(subtotal.region, "x") && center(region, "y") >= startY && center(region, "y") <= startY + 0.07 && numberValue(region.text) !== null)
    .sort((left, right) => center(right, "y") - center(left, "y"))[0] || null;
}

export function extractGenericInvoiceDraft({ observation, ocrText = "" } = {}) {
  const normalizedObservation = normalizeOcrObservation(observation);
  const regions = normalizedObservation.regions;
  const rows = groupRows(regions);
  const vendor = vendorCandidate(regions);
  const invoiceNumber = valueRightOfLabel(regions, /^(?:parts )?invoice(?: number| no| #)?/);
  const invoiceDate = valueRightOfLabel(regions, /^(?:date invoice|invoice date|date)$/);
  const purchaseOrder = valueRightOfLabel(regions, /^(?:purchase order(?: no)?|po|po #)$/);
  const subtotal = valueRightOfLabel(regions, /^(?:sub ?total)(?:[:# -].*)?$/, { numeric: true });
  const tax = valueRightOfLabel(regions, /^(?:sales )?tax(?:[:# -].*)?$/, { numeric: true });
  const shipping = valueRightOfLabel(regions, /^(?:shipping|shipping & handling|freight)(?:[:# -].*)?$/, { numeric: true });
  let total = valueRightOfLabel(regions, /^(?:total|please pay(?: usd)?)(?:[:# -].*)?$/, { numeric: true });
  if (!total) {
    const fallback = totalFallback(regions, subtotal);
    if (fallback) total = { text: fallback.text, region: fallback };
  }
  const text = String(ocrText || regions.map((region) => region.text).join("\n"));
  const lines = genericLines(rows, regions);
  const warnings = ["Local OCR bootstrap extraction; review required before learning or inventory use."];
  if (!lines.length) warnings.push("No line-item table was confidently detected.");
  if (!invoiceNumber) warnings.push("Invoice number was not confidently detected.");
  if (!total) warnings.push("Invoice total was not confidently detected.");
  return {
    documentType: field(/credit memo/i.test(text) ? "credit_memo" : /invoice/i.test(text) ? "invoice" : "unknown", null, 80, "Derived from local OCR document text"),
    vendorName: field(vendor?.text || "", vendor),
    vendorAccount: field(""),
    invoiceNumber: field(invoiceNumber?.text || "", invoiceNumber?.region),
    invoiceDate: field(invoiceDate?.text || "", invoiceDate?.region),
    purchaseOrderNumber: field(purchaseOrder?.text || "", purchaseOrder?.region),
    currency: field(text.includes("$") ? "USD" : "UNKNOWN", null, text.includes("$") ? 80 : 0, text.includes("$") ? "Currency symbol in local OCR text" : "Currency not found"),
    subtotal: field(numberValue(subtotal?.text), subtotal?.region),
    tax: field(numberValue(tax?.text), tax?.region),
    shipping: field(numberValue(shipping?.text), shipping?.region),
    total: field(numberValue(total?.text), total?.region),
    lines,
    warnings,
  };
}

export function genericDraftHasEvidence(draft) {
  return Boolean(draft?.invoiceNumber?.value || draft?.total?.value !== null || draft?.lines?.length);
}
