const pricePattern = /^\d{1,10}(\.\d{1,4})?$/;

export function purchaseLineEditDraft(order) {
  return { version: order.version, lines: order.lines.map((line) => ({
    id: line.id, isNew: false, catalogPartId: line.catalog_part_id || null, originalCatalogPartId: line.catalog_part_id || null,
    partNumber: line.part_number, query: line.part_number, description: line.description || '',
    uomCode: line.uom_code, trackingMode: line.tracking_mode,
    quantity: String(line.quantity), unitPrice: line.unit_price == null ? '' : String(line.unit_price),
    demandLinked: Boolean(line.demand_sources?.length),
  })) };
}

export function newPurchaseLine(id) {
  return { id, isNew: true, catalogPartId: null, originalCatalogPartId: null, partNumber: '', query: '',
    description: '', uomCode: 'ea', trackingMode: 'quantity', quantity: '1', unitPrice: '', demandLinked: false };
}

export function selectPurchaseLinePart(line, part) {
  return { ...line, catalogPartId: part.id, partNumber: part.partNumber, query: part.partNumber,
    description: part.description || '', uomCode: part.uomCode, trackingMode: part.trackingMode };
}

export function purchaseLineEditIssues(draft) {
  const seen = new Set();
  return draft.lines.flatMap((line, index) => {
    const prefix = `Line ${index + 1}: `, issues = [];
    if (!line.partNumber?.trim()) issues.push(prefix + 'enter a part number.');
    const identity = line.partNumber?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (identity && seen.has(identity)) issues.push(prefix + 'this part is already in the PO. Update its existing quantity.');
    if (identity) seen.add(identity);
    if (line.query !== line.partNumber) issues.push(prefix + 'select an inventory part from the search results.');
    if (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || Number(line.quantity) > 999999.999) issues.push(prefix + 'enter a quantity greater than zero and no more than 999,999.999.');
    if (line.unitPrice.trim() && !pricePattern.test(line.unitPrice.trim())) issues.push(prefix + 'enter a nonnegative unit price with up to four decimal places, or leave it blank.');
    return issues;
  });
}

export function purchaseLineEditPayload(draft) {
  return draft.lines.map((line) => ({ ...(!line.isNew ? { id: line.id } : {}), ...(line.catalogPartId ? { catalogPartId: line.catalogPartId } : {}),
    partNumber: line.partNumber.trim(), description: line.description.trim() || line.partNumber.trim(),
    uomCode: line.uomCode, trackingMode: line.trackingMode, quantity: Number(line.quantity),
    unitPrice: line.unitPrice.trim() || null,
  }));
}

export function purchaseLineEditTotal(lines) {
  if (lines.some((line) => !line.unitPrice.trim() || !pricePattern.test(line.unitPrice.trim()) || !Number.isFinite(Number(line.quantity)))) return null;
  return lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitPrice), 0);
}
