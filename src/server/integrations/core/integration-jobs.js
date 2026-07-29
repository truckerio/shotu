import crypto from "node:crypto";
import {
  claimNextIntegrationJob,
  completeIntegrationJob,
  failIntegrationJob,
} from "./integration-platform.repo.js";
import { getIntegrationJobHandler } from "./integration-provider.registry.js";

export function integrationRetryDelaySeconds(attempt, {
  baseSeconds = 15,
  maxSeconds = 3600,
} = {}) {
  return Math.min(maxSeconds, baseSeconds * (2 ** Math.max(0, Number(attempt) - 1)));
}

export async function runNextIntegrationJob({
  workerId = `integration-worker:${process.pid}:${crypto.randomUUID()}`,
} = {}) {
  const job = await claimNextIntegrationJob(workerId);
  if (!job) return null;
  try {
    const handler = getIntegrationJobHandler(job.provider, job.job_type);
    await handler(job);
    return completeIntegrationJob(job.id, job.attempts);
  } catch (error) {
    return failIntegrationJob(job, error, {
      retryDelaySeconds: integrationRetryDelaySeconds(job.attempts),
    });
  }
}
