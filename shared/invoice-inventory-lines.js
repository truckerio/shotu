function fieldValue(field) {
  return field?.value ?? field;
}

function normalizedIdentity(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleUpperCase("en-US")
    .replace(/[^A-Z0-9]+/g, "");
}

function moneyUnits(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function oppositeNumbers(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left + right) < 1e-9;
}

export function classifyInvoiceInventoryLines(lines = []) {
  const facts = lines.map((line, lineIndex) => ({
    lineIndex,
    partNumber: normalizedIdentity(fieldValue(line?.partNumber)),
    uomCode: normalizedIdentity(fieldValue(line?.unitOfMeasure)),
    quantity: Number(fieldValue(line?.quantity)),
    lineTotal: moneyUnits(fieldValue(line?.lineTotal)),
    inventoryDisposition: "stock",
    offsetLineIndex: null,
  }));
  const used = new Set();

  for (const positive of facts) {
    if (used.has(positive.lineIndex) || positive.quantity <= 0 || positive.lineTotal === null || positive.lineTotal <= 0) continue;
    const negative = facts.find((candidate) => (
      !used.has(candidate.lineIndex)
      && candidate.lineIndex !== positive.lineIndex
      && candidate.partNumber
      && candidate.partNumber === positive.partNumber
      && candidate.uomCode === positive.uomCode
      && candidate.quantity < 0
      && candidate.lineTotal !== null
      && oppositeNumbers(positive.quantity, candidate.quantity)
      && positive.lineTotal + candidate.lineTotal === 0
    ));
    if (!negative) continue;
    used.add(positive.lineIndex);
    used.add(negative.lineIndex);
    positive.inventoryDisposition = "financial_offset";
    positive.offsetLineIndex = negative.lineIndex;
    negative.inventoryDisposition = "financial_offset";
    negative.offsetLineIndex = positive.lineIndex;
  }

  return facts;
}

export function physicalInvoiceLineIndexes(lines = []) {
  return new Set(classifyInvoiceInventoryLines(lines)
    .filter((line) => line.inventoryDisposition === "stock")
    .map((line) => line.lineIndex));
}
