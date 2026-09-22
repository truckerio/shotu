import { locationId, locationPathLabel } from "./inventory-location-model.js";

export function receiptStoragePositions(positions = [], purpose = "receipt") {
  return positions
    .filter((position) => position.isActive !== false
      && position.canStore === true
      && position.isPickable === true
      && (((position.usage || position.usageCode) === "storage" && !position.systemKey)
        || (purpose === "transfer_receive" && (position.usage || position.usageCode) === "receiving" && position.systemKey === "receiving")))
    .map((position) => ({
      id: locationId(position),
      label: locationPathLabel(position, positions),
    }))
    .filter((position) => position.id)
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" }));
}

export function storagePositionPickerCopy(purpose = "receipt") {
  if (purpose === "transfer_receive") {
    return {
      label: "Put received stock in",
      emptyLabel: "Choose Receiving, shelf, or bin",
      helper: "Use Receiving for stock awaiting put-away, or choose its exact shelf or bin.",
      emptyHelper: "No Receiving area, shelf, or bin is configured for this shop.",
    };
  }
  if (purpose === "damage_release") {
    return {
      label: "Return released stock to",
      emptyLabel: "Choose shelf or bin",
      helper: "Choose the exact usable shelf or bin before this stock returns to service.",
    };
  }
  return {
    label: "Put stock in",
    emptyLabel: "Receiving area",
    helper: "Receiving keeps stock ready for put-away. Choose a shelf or bin when it is known.",
    emptyHelper: "Receiving is used until a pickable shelf or bin is configured.",
  };
}
