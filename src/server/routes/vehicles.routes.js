import { findVehicles, refreshVehicleLocation } from "../services/vehicles.service.js";

export async function handleVehiclesApi(req, res, url, helpers) {
  const { sendJson, requestContext } = helpers;
  const companyIds = [...(requestContext?.companyIds || [])];

  if (req.method === "GET" && url.pathname === "/api/vehicles/search") {
    const vehicles = await findVehicles(url.searchParams.get("q"), url.searchParams.get("limit"), companyIds);
    sendJson(res, 200, { vehicles });
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
