const validPrice = value => /^\d{1,10}(\.\d{1,4})?$/.test(String(value ?? '').trim());

export function validatePurchaseOrder({ draft, query, part, amount, price, placeOrder = false, lineOnly = false }) {
  const issues = [];
  const add = (field, message) => issues.push({ field, message });
  if (!lineOnly) {
    if (!draft.supplierId) add('supplier', 'Choose a supplier.');
    if (!/^[A-Z]{3}$/.test(draft.currency)) add('currency', 'Enter a three-letter currency, such as USD.');
    if (draft.lines.some(line => line.unitPrice !== null && String(line.unitPrice).trim() && !validPrice(line.unitPrice))) add('lines', 'Enter a valid unit price for each priced line, or leave it blank as Unknown.');
  }
  const hasEntry = Boolean(query.trim() || part);
  if (!hasEntry && (lineOnly || !draft.lines.length)) add('part', 'Enter at least one part.');
  if (hasEntry) {
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0 || Number(amount) > 999999.999) add('quantity', 'Enter a quantity greater than zero and no more than 999,999.999.');
    if (price.trim() && !validPrice(price)) add('price', 'Enter a valid unit price, such as 12.50.');
    if (draft.lines.some(line => part ? line.catalogPartId === part.id : line.partNumber?.toUpperCase() === query.trim().toUpperCase())) add('part', 'This part is already added. Remove its existing line to replace it.');
  }
  return issues;
}
