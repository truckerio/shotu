import "dotenv/config";
import { pathToFileURL } from "node:url";
import { closePool } from "../../src/server/db/pool.js";
import { resetActiveMechanicTemporaryPins } from "../../src/server/modules/kiosk/kiosk.service.js";

export const DEFAULT_TEMPORARY_KIOSK_PIN = "0000";
export const PRODUCTION_CONFIRMATION = "RESET_ALL_ACTIVE_MECHANIC_KIOSK_PINS";

export function resetCommandMode(args, environmentName) {
  const apply = args.includes("--apply");
  const confirmation = args.find((argument) => argument.startsWith("--confirm="))
    ?.slice("--confirm=".length);
  if (!apply) return "dry-run";
  if (environmentName !== "production") {
    throw new Error("Bulk kiosk PIN updates may only run in the production environment.");
  }
  if (confirmation !== PRODUCTION_CONFIRMATION) {
    throw new Error(`Pass --confirm=${PRODUCTION_CONFIRMATION} to apply the production reset.`);
  }
  return "apply";
}

async function countCandidates() {
  const { listActiveMechanicsForKioskPinReset } = await import(
    "../../src/server/db/repositories/kiosk.repo.js"
  );
  return (await listActiveMechanicsForKioskPinReset()).length;
}

export async function main() {
  const mode = resetCommandMode(
    process.argv.slice(2),
    process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV,
  );
  if (mode === "dry-run") {
    const candidateCount = await countCandidates();
    console.log(`Dry run: ${candidateCount} active mechanics are eligible for a temporary kiosk PIN reset.`);
    console.log(`No credentials changed. Re-run with --apply --confirm=${PRODUCTION_CONFIRMATION}.`);
    return;
  }

  const result = await resetActiveMechanicTemporaryPins(DEFAULT_TEMPORARY_KIOSK_PIN);
  if (result.updatedCount !== result.candidateCount) {
    throw new Error(
      `Kiosk PIN reset count mismatch: selected ${result.candidateCount}, updated ${result.updatedCount}.`,
    );
  }
  console.log(`Reset temporary kiosk credentials for ${result.updatedCount} active mechanics.`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(closePool);
}
