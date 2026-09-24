export const INVENTORY_LOCATION_TYPES = [
  ["warehouse", "Warehouse"],
  ["zone", "Zone"],
  ["room", "Room"],
  ["area", "Area"],
  ["aisle", "Aisle"],
  ["rack", "Rack"],
  ["shelf", "Shelf"],
  ["bin", "Bin"],
];
const positionTypes = new Set(INVENTORY_LOCATION_TYPES.map(([value]) => value));
const positionTypeLabels = new Map(INVENTORY_LOCATION_TYPES);
const PHYSICAL_SUBLOCATION_TYPES = ["zone", "room", "area", "aisle", "rack", "shelf", "bin"];
const SUBLOCATION_TYPES = {
  warehouse: PHYSICAL_SUBLOCATION_TYPES,
  zone: ["aisle", "area", "zone", "room", "rack", "shelf", "bin"],
  room: ["aisle", "area", "zone", "room", "rack", "shelf", "bin"],
  area: ["aisle", "area", "zone", "room", "rack", "shelf", "bin"],
  aisle: ["shelf", "rack"],
  rack: ["shelf", "bin"],
  shelf: ["bin"],
  bin: [],
};

export function sublocationTypeOptions(parentKind = null) {
  if (!parentKind) return INVENTORY_LOCATION_TYPES;
  return (SUBLOCATION_TYPES[parentKind] || []).map((value) => [value, positionTypeLabels.get(value)]);
}

export function defaultSublocationType(parentKind = null) {
  return sublocationTypeOptions(parentKind)[0]?.[0] || "";
}

export function canContainSublocations(kind) {
  return sublocationTypeOptions(kind).length > 0;
}
export function positionStorageDefaults(kind) {
  const storesStock = kind === "bin";
  return {
    usage: storesStock ? "storage" : "",
    canStore: storesStock,
    isPickable: storesStock,
  };
}

export function locationId(location) {
  return String(location?.id ?? location?.locationId ?? "");
}
export function locationName(location) {
  return (
    location?.name ||
    location?.locationName ||
    location?.code ||
    "Unnamed location"
  );
}
export function locationChildren(locations = [], parentId = null) {
  const isRoot = String(parentId ?? "") === "";
  const rootRank = (entry) => {
    if (!isRoot) return 0;
    if (entry?.kind === "warehouse") return 0;
    if (entry?.systemKey === "receiving") return 2;
    if (entry?.systemKey === "unassigned") return 3;
    if (["area", "zone", "room"].includes(entry?.kind)) return 1;
    return 4;
  };
  return locations
    .filter((entry) => String(entry?.parentId ?? "") === String(parentId ?? ""))
    .sort((left, right) => rootRank(left) - rootRank(right) || String(left.code || left.name || "").localeCompare(String(right.code || right.name || ""), undefined, { numeric: true }));
}
export function locationPath(location, locations = []) {
  const byId = new Map(locations.map((entry) => [locationId(entry), entry]));
  const path = [];
  const seen = new Set();
  let current = location;
  while (current && !seen.has(locationId(current))) {
    seen.add(locationId(current));
    path.unshift(current);
    current = byId.get(String(current.parentId ?? ""));
  }
  return path;
}
export function locationPathLabel(location, locations = []) {
  return locationPath(location, locations)
    .map((entry) =>
      entry.code && entry.name
        ? `${entry.code} · ${entry.name}`
        : entry.code || locationName(entry),
    )
    .join(" / ");
}
export function compactPlacementPath(placement = {}, omitSelectedRoot = false) {
  const codes = Array.isArray(placement.pathCodes)
    ? placement.pathCodes.filter(Boolean)
    : [];
  const kinds = Array.isArray(placement.pathKinds) ? placement.pathKinds : [];
  const coordinateKinds = new Set(["aisle", "shelf", "rack", "bay", "bin"]);
  const coordinates = codes.filter((_, index) => coordinateKinds.has(kinds[index]));
  const scopedCodes = omitSelectedRoot && codes.length > 1 ? codes.slice(1) : codes;
  const visibleCodes = coordinates.length ? coordinates : scopedCodes;
  // Imported shop coordinates are cumulative (A1, A1-B1, A1-B1-S3).
  // Showing every ancestor repeats the same information and makes scanning
  // harder, so prefer the final complete coordinate when it contains its
  // preceding coordinate. Non-cumulative custom codes keep their breadcrumb.
  const cumulative = visibleCodes.length > 1 && visibleCodes.every((code, index) => (
    index === 0 || String(code).toUpperCase().startsWith(`${String(visibleCodes[index - 1]).toUpperCase()}-`)
  ));
  return (cumulative ? visibleCodes.at(-1) : visibleCodes.join(" › ")) || placement.code || placement.name || "Stored here";
}
export function flattenLocationTree(
  locations = [],
  parentId = null,
  depth = 0,
  entries = [],
) {
  locationChildren(locations, parentId)
    .forEach((entry) => {
      entries.push({
        location: entry,
        depth,
        path: locationPathLabel(entry, locations),
      });
      flattenLocationTree(locations, locationId(entry), depth + 1, entries);
    });
  return entries;
}
export function visibleLocationTree(
  locations = [],
  expandedIds = new Set(),
  query = "",
) {
  const expanded = new Set([...expandedIds].map(String));
  const normalizedQuery = query.trim().toLowerCase();
  const matchingIds = normalizedQuery
    ? new Set(
        flattenLocationTree(locations)
          .filter(({ location, path }) =>
            `${path} ${location.code || ""} ${location.kind || ""}`
              .toLowerCase()
              .includes(normalizedQuery),
          )
          .map(({ location }) => locationId(location)),
      )
    : null;
  const visibleIds = matchingIds ? new Set(matchingIds) : null;
  if (matchingIds) {
    const byId = new Map(locations.map((entry) => [locationId(entry), entry]));
    matchingIds.forEach((id) => {
      let current = byId.get(id);
      const seen = new Set();
      while (current && !seen.has(locationId(current))) {
        seen.add(locationId(current));
        visibleIds.add(locationId(current));
        current = byId.get(String(current.parentId ?? ""));
      }
    });
  }
  const entries = [];
  function visit(parentId = null, depth = 0) {
    locationChildren(locations, parentId)
      .forEach((entry) => {
        const id = locationId(entry);
        if (visibleIds && !visibleIds.has(id)) return;
        const children = locationChildren(locations, id);
        const isExpanded = Boolean(normalizedQuery) || expanded.has(id);
        entries.push({
          location: entry,
          depth,
          path: locationPathLabel(entry, locations),
          hasChildren: children.length > 0,
          isExpanded,
          isMatch: matchingIds?.has(id) || false,
        });
        if (children.length && isExpanded) visit(id, depth + 1);
      });
  }
  visit();
  return entries;
}
export function locationDraft(location = {}) {
  return {
    code: location.code || "",
    name: location.name || location.locationName || "",
    type: positionTypes.has(location.type) ? location.type : "bin",
    holdsStock: location.holdsStock === true,
  };
}
export function positionDraftKey({
  partId,
  locationId,
  sourcePositionId,
  destinationPositionId,
  quantity,
  serialUnitIds = [],
}) {
  return `inventory-position:${[partId, locationId, sourcePositionId || "unassigned", destinationPositionId || "", quantity || "", [...serialUnitIds].sort().join(",")].join(":")}`;
}
export function positionRequestKey(
  identity,
  storage = globalThis.sessionStorage,
) {
  try {
    const stored = storage?.getItem(identity);
    if (stored) return stored;
  } catch {
    /* session storage is optional */
  }
  const next = crypto.randomUUID();
  try {
    storage?.setItem(identity, next);
  } catch {
    /* the mounted component keeps this request key */
  }
  return next;
}
export function clearPositionRequestKey(
  identity,
  storage = globalThis.sessionStorage,
) {
  try {
    storage?.removeItem(identity);
  } catch {
    /* session storage is optional */
  }
}
export function isStalePositionError(error) {
  return error?.status === 409 || /stale|conflict/i.test(error?.code || "");
}
export function countObservationChanged(observedQuantity, nextValue) {
  return (
    nextValue !== "" &&
    (observedQuantity === null ||
      Number(nextValue) !== Number(observedQuantity))
  );
}
export function destinationPositions(positions = []) {
  return positions.filter(
    (position) => position?.canStore === true && position?.isActive !== false,
  );
}
export function occupiedPositions(positions = []) {
  return positions.filter((position) => Number(position?.quantity || 0) > 0);
}
export function moveDestinations(positions = [], sourcePositionId = "") {
  return destinationPositions(positions).filter(
    (position) =>
      String(position.id ?? position.positionId) !== String(sourcePositionId),
  );
}
export function eligibleSerializedPositionUnits(units = [], sourcePositionId) {
  return units.filter(
    (unit) =>
      unit?.positionId === sourcePositionId &&
      ["in_stock", "reserved"].includes(unit?.status) &&
      (["new", "serviceable_used", "refurbished"].includes(
        unit?.conditionCode,
      ) ||
        (unit?.conditionCode === "unknown" &&
          unit?.custodyLegacyAvailable === true)),
  );
}
export function positionMoveBody({
  source,
  destination,
  quantity,
  unitIds = [],
  unitVersions = {},
  idempotencyKey,
  reason = "Positioned from Inventory",
}) {
  return {
    fromPositionId: source?.id || null,
    toPositionId: destination?.id,
    ...(unitIds.length
      ? { unitIds, unitVersions }
      : {
          quantity: Number(quantity),
          expectedSourceVersion: source?.version ?? null,
          expectedDestinationVersion: destination?.version ?? null,
        }),
    reason,
    idempotencyKey,
  };
}
