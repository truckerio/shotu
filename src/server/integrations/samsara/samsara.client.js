import { env, requireSamsaraToken } from "../../config/env.js";

export class SamsaraClient {
  constructor({ token = requireSamsaraToken(), baseUrl = env.samsaraApiBaseUrl } = {}) {
    this.token = token;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async request(path, params = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.token}`,
      },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(body.message || body.error || `Samsara request failed with ${response.status}`);
    }
    return body;
  }

  async listVehiclesPage({ after = "", limit = 512 } = {}) {
    return this.request("/fleet/vehicles", { after, limit });
  }

  async listTrailersPage({ after = "", limit = 512 } = {}) {
    return this.request("/fleet/trailers", { after, limit });
  }

  async listVehicleStats({ vehicleIds, types }) {
    return this.request("/fleet/vehicles/stats", {
      vehicleIds: vehicleIds.join(","),
      types: types.join(","),
    });
  }

  async listTrailerStats({ trailerIds, types }) {
    return this.request("/fleet/trailers/stats", {
      trailerIds: trailerIds.join(","),
      types: types.join(","),
    });
  }
}
