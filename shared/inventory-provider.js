export const APPLICATION_OWNED_INVENTORY_PROVIDERS = Object.freeze([
  "local",
  "local_count",
  "local_serialization",
]);

const APPLICATION_OWNED_PROVIDER_SET = new Set(APPLICATION_OWNED_INVENTORY_PROVIDERS);

export function isApplicationOwnedInventoryProvider(provider) {
  return APPLICATION_OWNED_PROVIDER_SET.has(String(provider || "").trim().toLowerCase());
}
