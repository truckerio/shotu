// Display permission only. Pricing mutations retain their existing server guards.
export function canViewWorkorderPrices(role) {
  return ["admin", "office", "surveillance"].includes(role);
}
