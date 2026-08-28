import { runNextIntegrationJob } from "./integration-jobs.js";
import "../samsara/samsara.adapter.js";

const DEFAULT_POLL_MS = 5_000;
let timer = null;
let running = false;

export async function drainIntegrationJobs({ maxJobs = 25 } = {}) {
  if (running) return [];
  running = true;
  const results = [];
  try {
    for (let index = 0; index < maxJobs; index += 1) {
      const result = await runNextIntegrationJob({ claimOptions: { excludeProviders: ["invoice_extraction"] } });
      if (!result) break;
      results.push(result);
    }
    return results;
  } finally {
    running = false;
  }
}

export function startIntegrationWorker({
  pollMs = Number(process.env.INTEGRATION_JOB_POLL_MS || DEFAULT_POLL_MS),
} = {}) {
  if (timer) return;
  const intervalMs = Math.max(1_000, Number(pollMs) || DEFAULT_POLL_MS);
  timer = setInterval(() => {
    drainIntegrationJobs().catch((error) => {
      console.warn(`Integration worker failed: ${error.message}`);
    });
  }, intervalMs);
  timer.unref?.();
  setTimeout(() => drainIntegrationJobs().catch(() => {}), 1_000).unref?.();
}

export function stopIntegrationWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}
