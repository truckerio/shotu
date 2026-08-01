import { env, requireSamsaraToken } from "../../config/env.js";

export class SamsaraApiError extends Error {
  constructor(message, { code = "", status = 0 } = {}) {
    super(message);
    this.name = "SamsaraApiError";
    this.code = code;
    this.status = status;
  }
}

export function isRejectedSamsaraApiCredential(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return Number(error?.status) === 401
    || ["invalid_token", "unauthorized"].includes(code)
    || message === "invalid token";
}

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
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { message: text };
    }
    if (!response.ok) {
      throw new SamsaraApiError(
        body.message || body.error_description || body.error || `Samsara request failed with ${response.status}`,
        {
          code: body.errorCode || body.error_code || body.code || body.error || "",
          status: response.status,
        },
      );
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
