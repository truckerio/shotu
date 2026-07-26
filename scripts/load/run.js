#!/usr/bin/env node
import process from "node:process";
import { parseLoadConfig, publicConfig } from "./config.js";
import { authenticateRole, LoadHttpClient } from "./http-client.js";
import { displaySummary, evaluateThresholds } from "./metrics.js";
import { runDraftConcurrency, runReadLoad } from "./scenarios.js";

function printHelp() {
  console.log(`Workorder production-gate load harness

Usage:
  node scripts/load/run.js --validate
  node scripts/load/run.js
  node scripts/load/run.js --drafts

The runner reads configuration and credentials from environment variables.
See scripts/load/README.md for the complete contract.`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const config = parseLoadConfig();
  console.log("Production-gate configuration:");
  console.log(JSON.stringify(publicConfig(config), null, 2));
  if (config.validateOnly) {
    console.log("Configuration is valid. No network requests were made.");
    return;
  }

  const controller = new AbortController();
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    controller.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const clients = {};
  const actors = {};
  try {
    console.log(`Authenticating ${config.roles.length} role session(s)...`);
    await Promise.all(config.roles.map(async (role) => {
      const client = new LoadHttpClient({
        baseUrl: config.baseUrl,
        requestTimeoutMs: config.requestTimeoutMs,
        role,
      });
      actors[role] = await authenticateRole(client, config.credentials[role]);
      clients[role] = client;
    }));
    console.log(`Authenticated roles: ${config.roles.join(", ")}.`);

    if (config.warmupMs > 0) {
      console.log(`Warming up for ${config.warmupMs / 1000}s...`);
      await runReadLoad({
        clients,
        durationMs: config.warmupMs,
        concurrencyPerRole: 1,
        signal: controller.signal,
      });
    }
    if (controller.signal.aborted) throw new Error("Load run interrupted.");

    console.log(
      `Running safe reads for ${config.durationMs / 1000}s at ${config.concurrencyPerRole} worker(s) per role...`,
    );
    const readResult = await runReadLoad({
      clients,
      durationMs: config.durationMs,
      concurrencyPerRole: config.concurrencyPerRole,
      signal: controller.signal,
    });
    const readSummary = readResult.metrics.summarize(readResult.durationMs);
    displaySummary(readSummary);
    const failures = evaluateThresholds(readSummary, config.thresholds);

    if (config.draft.enabled && !controller.signal.aborted) {
      console.log(
        `Running opt-in disposable-draft concurrency probe as ${config.draft.role}...`,
      );
      const draftResult = await runDraftConcurrency({
        client: clients[config.draft.role],
        actor: actors[config.draft.role],
        concurrency: config.draft.concurrency,
        staleAfterMs: config.draft.staleAfterMs,
        signal: controller.signal,
      });
      displaySummary(draftResult.metrics.summarize(draftResult.durationMs));
      console.log(JSON.stringify({
        staleFixturesCleaned: draftResult.staleCleaned,
        disposableDraftsCreatedAndDiscarded: draftResult.created,
        independentUpdates: draftResult.independentUpdates,
        optimisticLockWinnerCount: draftResult.collisionWinners,
        expectedConflictCount: draftResult.expectedConflicts,
      }, null, 2));
    }

    if (controller.signal.aborted || interrupted) failures.push("Run was interrupted.");
    if (failures.length) {
      console.error("PRODUCTION GATE FAILED");
      for (const failure of failures) console.error(`- ${failure}`);
      process.exitCode = 1;
      return;
    }
    console.log("PRODUCTION GATE PASSED");
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

main().catch((error) => {
  console.error(`PRODUCTION GATE ERROR: ${error.message}`);
  process.exitCode = 1;
});
