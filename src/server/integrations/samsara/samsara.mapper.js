function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || null;
}

function metersToMiles(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round((number / 1609.344) * 10) / 10;
}

function ownerNameFromAsset(asset) {
  const externalIds = asset.externalIds || {};
  const externalOwner = firstValue(
    externalIds.owner,
    externalIds.ownerName,
    externalIds.company,
    externalIds.companyName,
    externalIds.carrier,
    externalIds.carrierName,
    externalIds.teamName
  );
  if (externalOwner) return externalOwner;

  const tagNames = Array.isArray(asset.tags) ? asset.tags.map((tag) => tag?.name).filter(Boolean) : [];
  const genericTags = new Set(["assets", "fleet", "trailers", "fleet trailers", "trucks", "fleet trucks", "deactivated trailers", "deactivated trucks"]);
  const specificTag = tagNames.find((name) => !genericTags.has(String(name).trim().toLowerCase()));
  if (specificTag) return specificTag;

  const nameMatch = String(asset.name || "").match(/\(([^)]+)\)/);
  return nameMatch?.[1]?.trim() || null;
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
