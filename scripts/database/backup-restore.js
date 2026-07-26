#!/usr/bin/env node
import {
  helpText,
  normalizePostgresUrl,
  parseArgs,
  redactSensitiveText,
  runBackupRestoreVerification,
} from "./backup-restore-lib.js";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  const sourceRaw = process.env[options.sourceEnv];
  const targetRaw = process.env[options.targetEnv];
  const sourceUrl = normalizePostgresUrl(sourceRaw, options.sourceEnv);
  const targetUrl = normalizePostgresUrl(targetRaw, options.targetEnv);
  const migrationsDirectory = new URL("../../src/server/db/migrations/", import.meta.url);

  await runBackupRestoreVerification({
    sourceUrl,
    targetUrl,
    options,
    migrationsDirectory,
  });
}

main().catch((error) => {
  const knownSecrets = [
    process.env.DATABASE_URL,
    process.env.RESTORE_DATABASE_URL,
  ];
  console.error(`Backup/restore verification failed: ${redactSensitiveText(error.message, knownSecrets)}`);
  process.exitCode = 1;
});

