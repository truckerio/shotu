export function createPurchaseReceiptHandoff(poId, locationId, poNumber, key) {
  return { poId, locationId, poNumber, key };
}

export function consumePurchaseReceiptHandoff(current, key) {
  return current?.key === key ? null : current;
}

export function findPurchaseReceiptHandoffOrder(handoff, locationId, items, consumedKey) {
  if (!handoff?.poId || !handoff.key || handoff.key === consumedKey || handoff.locationId !== locationId) return null;
  return items?.find((order) => order.id === handoff.poId) || null;
}
