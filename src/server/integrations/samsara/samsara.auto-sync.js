import { env } from "../../config/env.js";
import { migrate } from "../../db/migrate.js";
import { listConnectedIntegrationAccounts } from "../../db/repositories/integrations.repo.js";
import { enqueueIntegrationJob } from "../core/integration-platform.repo.js";
import { runNextIntegrationJob } from "../core/integration-jobs.js";
import "./samsara.adapter.js";

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
    const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
    for (const account of accounts) {
      results.push(await enqueueIntegrationJob({
        companyId: account.company_id,
        integrationAccountId: account.id,
        provider: "samsara",
        jobType: "sync",
        payload: { syncType },
        idempotencyKey: `samsara:${syncType}:${account.company_id}:${bucket}`,
      }));
    }
    for (let index = 0; index < results.length; index += 1) {
      await runNextIntegrationJob();
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
