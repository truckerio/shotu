// Display classification only: provider tags never determine tenant access or legal ownership.
export function classifyUnitTag(name) {
  if (typeof name !== "string" || !name.trim()) return "other";
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const compact = normalized.replaceAll(" ", "");
  // These company families are explicitly identified by the fleet operator.
  if (/^spg(?:transportation|transport)?(?:inc|llc)?$/.test(compact)
    || /^protec(?:h)?(?:inc|llc)?$/.test(compact)
    || /^4s(?:transport|transportation|insurance)?(?:inc|llc)?$/.test(compact)) return "company";
  // Business names can include route words (e.g. Regional Transport).
  if (/\b(?:transportation|transport|translinex|freight|cargo|logistics|trucking|insurance|inc|incorporated|llc|ltd|limited|corp|corporation)\b/.test(normalized)
    && !/\b(?:monitoring|pilot|deactivated|backup)\b/.test(normalized)) return "company";
  if (/\b(?:local|regional)\b|\blong\s+haul\b/.test(normalized)) return "route";
  return "other";
}
