export function todayIso() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function splitSerial(serial = "") {
  const match = /^(.*?)(\d+)$/.exec(serial.trim());
  if (!match) return { prefix: "WO-", nextNumber: 1, digits: 6 };
  return { prefix: match[1], nextNumber: Number(match[2]), digits: match[2].length };
}

export function normalizeVehicleLookupValue(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function vehicleLookupValues(vehicle) {
  return [vehicle?.unit_no, vehicle?.unitNo, vehicle?.name]
    .map(normalizeVehicleLookupValue)
    .filter(Boolean);
}

export function uniqueExactVehicleMatch(vehicles, query) {
  const normalizedQuery = normalizeVehicleLookupValue(query);
  if (!normalizedQuery) return null;
  const matches = vehicles.filter((vehicle) => vehicleLookupValues(vehicle).includes(normalizedQuery));
  return matches.length === 1 ? matches[0] : null;
}
