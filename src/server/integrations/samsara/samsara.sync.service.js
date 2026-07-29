import { migrate } from "../../db/migrate.js";
import { upsertVehicles } from "../../db/repositories/assets.repo.js";
import {
  createSyncRun,
  disconnectIntegration,
  finishSyncRun,
  getIntegrationStatus,
  getLatestIntegrationSyncRun,
  upsertIntegrationStatus,
} from "../../db/repositories/integrations.repo.js";
import { env } from "../../config/env.js";
import { SamsaraClient } from "./samsara.client.js";
import { mapSamsaraTrailer, mapSamsaraVehicle } from "./samsara.mapper.js";
import { applyVinDecodes, decodeVinValuesBatch } from "../vin/vpic.client.js";
import { getSamsaraAccessToken } from "./samsara.oauth.service.js";
import { DEFAULT_COMPANY_ID } from "../../db/company.js";

const STAT_TYPES = ["obdOdometerMeters", "gpsOdometerMeters", "gps"];
const activeSyncPromises = new Map();

function publicLatestSync(run) {
  if (!run) return null;
  return {
    id: run.id,
    type: run.sync_type,
    status: run.status,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    fetchedCount: Number(run.fetched_count) || 0,
    changedCount: Number(run.changed_count) || 0,
    hasError: Boolean(run.has_error),
  };
}

export function publicSamsaraStatus({
  account,
  latestSync,
  hasApiToken = false,
}) {
  const hasOAuth = Boolean(account?.has_credentials || account?.access_token || account?.refresh_token);
  const oauthPending = account?.status === "oauth_pending";
  let status = "missing_token";
  if (hasOAuth) status = account?.status || "connected";
  else if (hasApiToken) status = account?.status === "error" ? "error" : "configured";
  else if (oauthPending || account?.status === "disconnected") status = account.status;

  return {
    configured: Boolean(hasOAuth || hasApiToken),
    provider: "samsara",
    authType: hasOAuth || oauthPending ? "oauth" : hasApiToken ? "api_token" : "none",
    status,
    lastFullSyncAt: account?.last_full_sync_at || null,
    latestSync: publicLatestSync(latestSync),
  };
}

export async function samsaraStatus(companyId = DEFAULT_COMPANY_ID) {
  await migrate();
  const [account, latestSync] = await Promise.all([
    getIntegrationStatus("samsara", companyId),
    getLatestIntegrationSyncRun("samsara", companyId),
  ]);
  return publicSamsaraStatus({
    account,
    latestSync,
    hasApiToken: companyId === DEFAULT_COMPANY_ID && Boolean(env.samsaraApiToken),
  });
}

export async function disconnectSamsara(companyId = DEFAULT_COMPANY_ID) {
  await migrate();
  await disconnectIntegration("samsara", companyId);
  return samsaraStatus(companyId);
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
