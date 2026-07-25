import { env } from "../../config/env.js";
import { migrate } from "../../db/migrate.js";
import { getIntegrationStatus } from "../../db/repositories/integrations.repo.js";
import { syncSamsaraVehicles } from "./samsara.sync.service.js";

const MIN_INTERVAL_MS = 5 * 60 * 1000;

let schedulerStarted = false;

async function hasOAuthConnection() {
  await migrate();
  const account = await getIntegrationStatus("samsara");
  return Boolean(account?.access_token || account?.refresh_token);
}

export async function runAutomaticSamsaraSync(syncType = "auto") {
  try {
    if (!(await hasOAuthConnection())) return null;
    return await syncSamsaraVehicles({ syncType, allowApiTokenFallback: false });
  } catch (error) {
    console.warn(`Samsara ${syncType} sync failed: ${error.message}`);
    return null;
  }
}

export function startSamsaraAutoSync() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const intervalMs = Math.max(MIN_INTERVAL_MS, (Number(env.samsaraSyncIntervalMinutes) || 30) * 60 * 1000);
  if (env.samsaraSyncOnStartup) {
    setTimeout(() => {
      runAutomaticSamsaraSync("startup").catch(() => {});
    }, 5000);
  }

  setInterval(() => {
    runAutomaticSamsaraSync("scheduled").catch(() => {});
  }, intervalMs);
}
