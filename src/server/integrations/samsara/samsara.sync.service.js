import { migrate } from "../../db/migrate.js";
import { upsertVehicles } from "../../db/repositories/assets.repo.js";
import { createSyncRun, finishSyncRun, getIntegrationStatus, upsertIntegrationStatus } from "../../db/repositories/integrations.repo.js";
import { env } from "../../config/env.js";
import { SamsaraClient } from "./samsara.client.js";
import { mapSamsaraTrailer, mapSamsaraVehicle } from "./samsara.mapper.js";
import { applyVinDecodes, decodeVinValuesBatch } from "../vin/vpic.client.js";
import { getSamsaraAccessToken } from "./samsara.oauth.service.js";
import { DEFAULT_COMPANY_ID } from "../../db/company.js";

const STAT_TYPES = ["obdOdometerMeters", "gpsOdometerMeters", "gps"];
const activeSyncPromises = new Map();

export async function samsaraStatus(companyId = DEFAULT_COMPANY_ID) {
  await migrate();
  const status = await getIntegrationStatus("samsara", companyId);
  const hasOAuth = Boolean(status?.access_token || status?.refresh_token);
  return {
    configured: Boolean(hasOAuth || env.samsaraApiToken),
    provider: "samsara",
    authType: hasOAuth ? "oauth" : env.samsaraApiToken ? "api_token" : "none",
    status: hasOAuth || env.samsaraApiToken ? status?.status || "configured" : "missing_token",
    lastFullSyncAt: status?.last_full_sync_at || null,
  };
}

export async function testSamsaraConnection(companyId = DEFAULT_COMPANY_ID) {
  await migrate();
  const auth = await getSamsaraAccessToken({ companyId });
  const client = new SamsaraClient({ token: auth.token });
  await client.listVehiclesPage({ limit: 1 });
  return upsertIntegrationStatus("samsara", {
    status: "connected",
    tokenEnvKey: auth.source === "oauth" ? "SAMSARA_OAUTH" : "SAMSARA_API_TOKEN",
  }, companyId);
}

async function runSamsaraSync({
  syncType = "manual",
  allowApiTokenFallback = true,
  companyId = DEFAULT_COMPANY_ID,
} = {}) {
  await migrate();
  const auth = await getSamsaraAccessToken({ allowApiTokenFallback, companyId });
  const client = new SamsaraClient({ token: auth.token });
  const run = await createSyncRun("samsara", syncType, companyId);
  try {
    const vehicles = [];
    let after = "";
    for (let page = 0; page < 50; page += 1) {
      const body = await client.listVehiclesPage({ after, limit: 512 });
      vehicles.push(...(body.data || []));
      after = body.pagination?.endCursor || "";
      if (!body.pagination?.hasNextPage || !after) break;
    }

    const trailers = [];
    after = "";
    for (let page = 0; page < 50; page += 1) {
      const body = await client.listTrailersPage({ after, limit: 512 });
      trailers.push(...(body.data || []));
      after = body.pagination?.endCursor || "";
      if (!body.pagination?.hasNextPage || !after) break;
    }

    const statsByVehicleId = new Map();
    for (let index = 0; index < vehicles.length; index += 50) {
      const chunk = vehicles.slice(index, index + 50);
      if (!chunk.length) continue;
      try {
        const statsBody = await client.listVehicleStats({
          vehicleIds: chunk.map((vehicle) => String(vehicle.id)),
          types: STAT_TYPES,
        });
        for (const stat of statsBody.data || []) {
          statsByVehicleId.set(String(stat.id), stat);
        }
      } catch {
        // Vehicle identity sync is still useful when telemetry stats are unavailable.
      }
    }

    const statsByTrailerId = new Map();
    for (let index = 0; index < trailers.length; index += 50) {
      const chunk = trailers.slice(index, index + 50);
      if (!chunk.length) continue;
      try {
        const statsBody = await client.listTrailerStats({
          trailerIds: chunk.map((trailer) => String(trailer.id)),
          types: ["gps"],
        });
        for (const stat of statsBody.data || []) {
          statsByTrailerId.set(String(stat.id), stat);
        }
      } catch {
        // Trailer identity sync is still useful when GPS stats are unavailable.
      }
    }

    const mappedAssets = [
      ...vehicles.map((vehicle) => mapSamsaraVehicle(vehicle, statsByVehicleId)),
      ...trailers.map((trailer) => mapSamsaraTrailer(trailer, statsByTrailerId)),
    ];
    const decodedByVin = await decodeVinValuesBatch(mappedAssets.map((asset) => asset.vin));
    const mapped = applyVinDecodes(mappedAssets, decodedByVin);
    const changedCount = await upsertVehicles(mapped, companyId);
    await upsertIntegrationStatus("samsara", {
      status: "connected",
      tokenEnvKey: auth.source === "oauth" ? "SAMSARA_OAUTH" : "SAMSARA_API_TOKEN",
      lastFullSyncAt: new Date().toISOString(),
    }, companyId);
    return finishSyncRun(run.id, {
      status: "completed",
      fetchedCount: mapped.length,
      changedCount,
    });
  } catch (error) {
    await upsertIntegrationStatus("samsara", {
      status: "error",
      tokenEnvKey: auth.source === "oauth" ? "SAMSARA_OAUTH" : "SAMSARA_API_TOKEN",
    }, companyId);
    return finishSyncRun(run.id, {
      status: "failed",
      error: error.message,
    });
  }
}

export async function syncSamsaraVehicles(options = {}) {
  const companyId = options.companyId || DEFAULT_COMPANY_ID;
  if (activeSyncPromises.has(companyId)) return activeSyncPromises.get(companyId);
  const promise = runSamsaraSync({ ...options, companyId }).finally(() => {
    activeSyncPromises.delete(companyId);
  });
  activeSyncPromises.set(companyId, promise);
  return promise;
}
