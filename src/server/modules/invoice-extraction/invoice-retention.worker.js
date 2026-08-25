import { migrate } from "../../db/migrate.js";
import { deleteExpiredInvoiceSources } from "../../db/repositories/invoice-extractions.repo.js";

const INTERVAL_MS = 24 * 60 * 60 * 1000;
let startupTimer = null;
let intervalTimer = null;

export async function runInvoiceRetention() {
  try {
    await migrate();
    let deleted = 0;
    let batch;
    do {
      batch = await deleteExpiredInvoiceSources({ limit: 100 });
      deleted += batch;
    } while (batch === 100);
    if (deleted) console.info(`Invoice retention erased ${deleted} expired encrypted source${deleted === 1 ? "" : "s"}.`);
    return deleted;
  } catch (error) {
    console.warn(`Invoice retention failed: ${error.message}`);
    return null;
  }
}

export function startInvoiceRetention() {
  if (startupTimer || intervalTimer) return;
  startupTimer = setTimeout(() => {
    startupTimer = null;
    runInvoiceRetention().catch(() => {});
  }, 30_000);
  startupTimer.unref?.();
  intervalTimer = setInterval(() => runInvoiceRetention().catch(() => {}), INTERVAL_MS);
  intervalTimer.unref?.();
}

export function stopInvoiceRetention() {
  if (startupTimer) clearTimeout(startupTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  startupTimer = null;
  intervalTimer = null;
}
