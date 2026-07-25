import { migrate } from "../db/migrate.js";
import { getVehicleById, searchVehicles, updateVehicleLocation } from "../db/repositories/assets.repo.js";
import { SamsaraClient } from "../integrations/samsara/samsara.client.js";
import { getSamsaraAccessToken } from "../integrations/samsara/samsara.oauth.service.js";

export async function findVehicles(query, limit) {
  await migrate();
  return searchVehicles(query, limit);
}

export async function refreshVehicleLocation(id) {
  await migrate();
  const vehicle = await getVehicleById(id);
  if (!vehicle) throw new Error("Vehicle not found.");
  if (vehicle.provider !== "samsara" || !vehicle.provider_vehicle_id) {
    throw new Error("Live location is only available for Samsara assets.");
  }

  const auth = await getSamsaraAccessToken();
  const client = new SamsaraClient({ token: auth.token });
  const providerId = String(vehicle.provider_vehicle_id);
  const isTrailer = vehicle.unit_type === "Trailer" || providerId.startsWith("trailer:");
  const samsaraId = providerId.replace(/^trailer:/, "");
  const body = isTrailer
    ? await client.listTrailerStats({ trailerIds: [samsaraId], types: ["gps"] })
    : await client.listVehicleStats({ vehicleIds: [samsaraId], types: ["gps"] });
  const gps = body.data?.[0]?.gps;
  if (!gps?.latitude || !gps?.longitude) {
    throw new Error("Samsara did not return a GPS location for this asset.");
  }
  return updateVehicleLocation(vehicle.id, gps, gps.time || vehicle.last_seen_at);
}
