import { migrate } from "../../db/migrate.js";
import { deleteExpiredInventoryCountSources } from "../../db/repositories/inventory-count-imports.repo.js";

const INTERVAL_MS = 24 * 60 * 60 * 1000;
let startupTimer = null;
let intervalTimer = null;

export async function runInventoryCountRetention() {
  try {
    await migrate();
    let deleted = 0;
    let batch = 0;
    do {
      batch = await deleteExpiredInventoryCountSources({ limit: 100 });
      deleted += batch;
    } while (batch === 100);
    if (deleted) console.info(`Inventory count retention erased ${deleted} expired encrypted source${deleted === 1 ? "" : "s"}.`);
    return deleted;
  } catch (error) {
    console.warn(`Inventory count retention failed: ${error.message}`);
    return null;
  }
}

export function startInventoryCountRetention() {
  if (startupTimer || intervalTimer) return;
  startupTimer = setTimeout(() => {
    startupTimer = null;
    runInventoryCountRetention().catch(() => {});
  }, 30_000);
  startupTimer.unref?.();
  intervalTimer = setInterval(() => runInventoryCountRetention().catch(() => {}), INTERVAL_MS);
  intervalTimer.unref?.();
}

export function stopInventoryCountRetention() {
  if (startupTimer) clearTimeout(startupTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  startupTimer = null;
  intervalTimer = null;
}
