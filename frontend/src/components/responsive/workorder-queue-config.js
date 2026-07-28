export function uniqueKnownValues(values) {
  return [...new Set(values.filter((value) => value && value !== "Unassigned" && value !== "Location not set"))];
}

export function workorderMobileMeta({ location, mechanic }) {
  return uniqueKnownValues([location, mechanic]).join(" · ");
}

export function workorderOpenLabel({ serial, unit, concern }) {
  const identity = serial ? `workorder ${serial}` : "workorder";
  const asset = unit ? ` for ${unit}` : "";
  const problem = concern ? `: ${concern}` : "";
  return `Open ${identity}${asset}${problem}`;
}
