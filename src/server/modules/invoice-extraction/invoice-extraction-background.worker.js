import crypto from "node:crypto";
import { runNextIntegrationJob } from "../../integrations/core/integration-jobs.js";
import { invoiceExtractionConfig } from "./invoice-extraction.config.js";
import "./invoice-extraction.worker.js";

const DEFAULT_POLL_MS = 1_000;
let timer = null;
let running = false;

async function drainLane(maxJobs) {
  const results = [];
  for (let index = 0; index < maxJobs; index += 1) {
    const result = await runNextIntegrationJob({
      workerId: `invoice-worker:${process.pid}:${crypto.randomUUID()}`,
      claimOptions: { includeProviders: ["invoice_extraction"], leaseMinutes: 5 },
    });
    if (!result) break;
    results.push(result);
  }
  return results;
}

export async function drainInvoiceExtractionJobs({ maxJobs = 10, concurrency = invoiceExtractionConfig.workerConcurrency } = {}) {
  if (running) return [];
  running = true;
  try {
    const laneCount = Math.min(4, Math.max(1, Number(concurrency) || 1));
    const laneLimit = Math.max(1, Math.ceil(Math.min(40, Math.max(1, Number(maxJobs) || 10)) / laneCount));
    return (await Promise.all(Array.from({ length: laneCount }, () => drainLane(laneLimit)))).flat();
  } finally {
    running = false;
  }
}

export function startInvoiceExtractionWorker({
  pollMs = Number(process.env.INVOICE_EXTRACTION_WORKER_POLL_MS || DEFAULT_POLL_MS),
} = {}) {
  if (timer) return;
  const intervalMs = Math.max(500, Number(pollMs) || DEFAULT_POLL_MS);
  timer = setInterval(() => {
    drainInvoiceExtractionJobs().catch((error) => {
      console.warn(`Invoice extraction worker failed: ${error.message}`);
    });
  }, intervalMs);
  timer.unref?.();
  setTimeout(() => drainInvoiceExtractionJobs().catch(() => {}), 250).unref?.();
}

export function stopInvoiceExtractionWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}
