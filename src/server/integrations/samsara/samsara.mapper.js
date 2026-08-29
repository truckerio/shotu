function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || null;
}

function metersToMiles(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round((number / 1609.344) * 10) / 10;
}

const MAX_TAG_NAMES = 25;
const MAX_TAG_NAME_LENGTH = 120;

export function normalizeSamsaraTagNames(tags) {
  if (!Array.isArray(tags)) return [];

  const seen = new Set();
  const tagNames = [];
  for (const tag of tags) {
    if (typeof tag?.name !== "string") continue;
    const name = tag.name.trim().slice(0, MAX_TAG_NAME_LENGTH);
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    tagNames.push(name);
    if (tagNames.length === MAX_TAG_NAMES) break;
  }
  return tagNames;
}

function ownerNameFromAsset(asset) {
  const externalIds = asset.externalIds || {};
  const candidates = [
    externalIds.owner,
    externalIds.ownerName,
    externalIds.company,
    externalIds.companyName,
    externalIds.carrier,
    externalIds.carrierName,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const ownerName = candidate.trim().slice(0, 300);
    if (ownerName) return ownerName;
  }
  return null;
}

function statValue(statsByVehicleId, vehicleId, type) {
  const stat = statsByVehicleId.get(String(vehicleId));
  const value = stat?.[type];
  if (Array.isArray(value)) return value.at(-1)?.value ?? null;
  if (type === "gps" && value && typeof value === "object") return value;
  if (value && typeof value === "object") return value.value ?? null;
  return value ?? null;
}

export function mapSamsaraVehicle(vehicle, statsByVehicleId = new Map()) {
  const providerVehicleId = String(vehicle.id || "");
  const externalIds = vehicle.externalIds || {};
  const odometerMeters = firstValue(
    statValue(statsByVehicleId, providerVehicleId, "obdOdometerMeters"),
    statValue(statsByVehicleId, providerVehicleId, "gpsOdometerMeters")
  );
  const gps = statValue(statsByVehicleId, providerVehicleId, "gps");
  const makeModel = firstValue(vehicle.makeModel, vehicle.model);

  return {
    provider: "samsara",
    providerVehicleId,
    unitType: "Truck",
    ownerName: ownerNameFromAsset(vehicle),
    tagNames: normalizeSamsaraTagNames(vehicle.tags),
    name: firstValue(vehicle.name, vehicle.externalIds?.["samsara.name"]),
    unitNo: firstValue(vehicle.name, vehicle.externalIds?.unit, vehicle.externalIds?.unitNo, vehicle.externalIds?.vehicleId),
    vin: firstValue(vehicle.vin),
    licensePlate: firstValue(vehicle.licensePlate),
    make: firstValue(vehicle.make),
    model: makeModel,
    year: Number.isFinite(Number(vehicle.year)) ? Number(vehicle.year) : null,
    serial: firstValue(vehicle.serial),
    externalIds,
    raw: vehicle,
    lastOdometerMeters: odometerMeters,
    lastOdometerMiles: metersToMiles(odometerMeters),
    lastLocation: gps || null,
    lastSeenAt: firstValue(vehicle.updatedAtTime, vehicle.createdAtTime, gps?.time),
  };
}

export function mapSamsaraTrailer(trailer, statsByTrailerId = new Map()) {
  const trailerId = String(trailer.id || "");
  const providerVehicleId = `trailer:${trailerId}`;
  const externalIds = trailer.externalIds || {};
  const gps = statValue(statsByTrailerId, trailerId, "gps");
  return {
    provider: "samsara",
    providerVehicleId,
    unitType: "Trailer",
    ownerName: ownerNameFromAsset(trailer),
    tagNames: normalizeSamsaraTagNames(trailer.tags),
    name: firstValue(trailer.name),
    unitNo: firstValue(trailer.name, externalIds.unit, externalIds.unitNo, externalIds.trailerId),
    vin: firstValue(trailer.vin, externalIds["samsara.vin"], trailer.trailerSerialNumber),
    licensePlate: firstValue(
      trailer.licensePlate,
      trailer.licensePlateNumber,
      trailer.plate,
      trailer.plateNumber,
      externalIds["samsara.license_plate"],
      externalIds.licensePlate
    ),
    make: firstValue(trailer.make, trailer.trailerMake),
    model: firstValue(trailer.model, trailer.trailerModel),
    year: Number.isFinite(Number(trailer.year || trailer.modelYear)) ? Number(trailer.year || trailer.modelYear) : null,
    serial: firstValue(trailer.serial, trailer.trailerSerialNumber),
    externalIds,
    raw: trailer,
    lastOdometerMeters: null,
    lastOdometerMiles: null,
    lastLocation: gps || null,
    lastSeenAt: firstValue(gps?.time, trailer.updatedAtTime, trailer.createdAtTime),
  };
}
