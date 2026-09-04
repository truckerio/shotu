import { createManualVehicle, findVehicleById, findVehicles, refreshVehicleLocation } from "../services/vehicles.service.js";
import { createManualVehicleSchema } from "../modules/vehicles/manual-vehicle.service.js";
import { readUnitsDirectory } from "../modules/vehicles/units-directory.service.js";

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const error = new Error(result.error.issues[0]?.message || "Invalid vehicle request.");
  error.statusCode = 400;
  throw error;
}

export async function handleVehiclesApi(req, res, url, helpers, dependencies = {}) {
  const { sendJson, requestContext, readBody } = helpers;
  const companyIds = [...(requestContext?.companyIds || [])];

  if (req.method === "POST" && url.pathname === "/api/vehicles/manual") {
    const vehicle = await (dependencies.createManual || createManualVehicle)(requestContext, parse(createManualVehicleSchema, await readBody(req)));
    sendJson(res, 201, { vehicle });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/vehicles/search") {
    const vehicles = await findVehicles(url.searchParams.get("q"), url.searchParams.get("limit"), companyIds);
    sendJson(res, 200, { vehicles });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/vehicles/directory") {
    const raw = {};
    for (const key of ["q", "type", "limit", "cursor"]) {
      const value = url.searchParams.get(key);
      if (value !== null) raw[key] = value;
    }
    sendJson(res, 200, await (dependencies.directory || readUnitsDirectory)(requestContext, raw, dependencies.directoryDependencies));
    return true;
  }

  const vehicleMatch = /^\/api\/vehicles\/([^/]+)$/.exec(url.pathname);
  if (req.method === "GET" && vehicleMatch) {
    const vehicle = await findVehicleById(decodeURIComponent(vehicleMatch[1]), companyIds);
    if (!vehicle) {
      sendJson(res, 404, { error: "Vehicle not found." });
      return true;
    }
    sendJson(res, 200, { vehicle });
    return true;
  }

  const liveLocationMatch = /^\/api\/vehicles\/([^/]+)\/live-location$/.exec(url.pathname);
  if (req.method === "POST" && liveLocationMatch) {
    const vehicle = await refreshVehicleLocation(decodeURIComponent(liveLocationMatch[1]), companyIds);
    sendJson(res, 200, { vehicle });
    return true;
  }

  return false;
}
