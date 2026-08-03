import { migrate } from "../db/migrate.js";
import { getVehicleById, searchVehicles, updateVehicleLocation } from "../db/repositories/assets.repo.js";
import { withSamsaraClient } from "../integrations/samsara/samsara.oauth.service.js";
import { recordSamsaraConnectionFailure } from "../integrations/samsara/samsara.connection-health.js";

export async function findVehicles(query, limit, companyIds) {
  await migrate();
  return searchVehicles(query, limit, companyIds);
}

export async function findVehicleById(id, companyIds) {
  await migrate();
  return getVehicleById(id, companyIds);
}

export function hasValidGpsCoordinates(gps) {
  const hasCoordinate = (value) =>
    value !== null
    && value !== undefined
    && value !== ""
    && Number.isFinite(Number(value));
  return hasCoordinate(gps?.latitude) && hasCoordinate(gps?.longitude);
}

export async function refreshVehicleLocation(id, companyIds) {
  await migrate();
  const vehicle = await getVehicleById(id, companyIds);
  if (!vehicle) throw new Error("Vehicle not found.");
  if (vehicle.provider !== "samsara" || !vehicle.provider_vehicle_id) {
    throw new Error("Live location is only available for Samsara assets.");
  }

  const providerId = String(vehicle.provider_vehicle_id);
  const isTrailer = vehicle.unit_type === "Trailer" || providerId.startsWith("trailer:");
  const samsaraId = providerId.replace(/^trailer:/, "");
  let body;
  try {
    ({ result: body } = await withSamsaraClient(
      (client) => isTrailer
        ? client.listTrailerStats({ trailerIds: [samsaraId], types: ["gps"] })
        : client.listVehicleStats({ vehicleIds: [samsaraId], types: ["gps"] }),
      { companyId: vehicle.company_id },
    ));
  } catch (error) {
    throw await recordSamsaraConnectionFailure(vehicle.company_id, error);
  }
  const gps = body.data?.[0]?.gps;
  if (!hasValidGpsCoordinates(gps)) {
    throw new Error("Samsara did not return a GPS location for this asset.");
  }
  const updatedVehicle = await updateVehicleLocation(
    vehicle.id,
    vehicle.company_id,
    gps,
    gps.time || vehicle.last_seen_at
  );
  if (!updatedVehicle) throw new Error("Vehicle not found.");
  return updatedVehicle;
}
