import { env } from "../../config/env.js";
import { migrate } from "../../db/migrate.js";
import { listConnectedIntegrationAccounts } from "../../db/repositories/integrations.repo.js";
import { syncSamsaraVehicles } from "./samsara.sync.service.js";

const MIN_INTERVAL_MS = 5 * 60 * 1000;

let schedulerStarted = false;
let startupTimer = null;
let intervalTimer = null;

async function connectedCompanies() {
  await migrate();
  return listConnectedIntegrationAccounts("samsara");
}

export async function runAutomaticSamsaraSync(syncType = "auto") {
  try {
    const accounts = await connectedCompanies();
    if (!accounts.length) return [];
    const results = [];
    for (const account of accounts) {
      results.push(await syncSamsaraVehicles({
        syncType,
        allowApiTokenFallback: false,
        companyId: account.company_id,
      }));
    }
    return results;
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
    startupTimer = setTimeout(() => {
      runAutomaticSamsaraSync("startup").catch(() => {});
    }, 5000);
    startupTimer.unref?.();
  }

  intervalTimer = setInterval(() => {
    runAutomaticSamsaraSync("scheduled").catch(() => {});
  }, intervalMs);
  intervalTimer.unref?.();
}

export function stopSamsaraAutoSync() {
  if (startupTimer) clearTimeout(startupTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  startupTimer = null;
  intervalTimer = null;
  schedulerStarted = false;
}
