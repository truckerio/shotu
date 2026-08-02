import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "../../src/server/db/pool.js";
import { manageQaAccounts } from "./qa-accounts-service.js";
import { assertQaTargetSafety, redactQaError } from "./safety.js";

export function parseArguments(argv) {
  const [action = ""] = argv;
  const values = {};
  for (const argument of argv.slice(1)) {
    if (!argument.startsWith("--")) throw new Error(`Unknown argument ${argument}.`);
    const [key, ...parts] = argument.slice(2).split("=");
    values[key] = parts.length ? parts.join("=") : true;
  }
  return { action, values };
}

export async function runQaAccountCommand({ argv = process.argv.slice(2), environment = process.env, logger = console } = {}) {
  const { action, values } = parseArguments(argv);
  const safety = assertQaTargetSafety({
    environment,
    options: {
      target: values.target,
      allowProduction: values["allow-production"] === true,
      productionConfirmation: values["confirm-production"],
      confirmDatabaseHost: values["confirm-database-host"],
    },
  });
  const pool = getPool();
  let authInstance;
  if (action === "apply" || action === "reset") {
    ({ auth: authInstance } = await import("../../src/server/auth/auth.js"));
  }
  const result = await manageQaAccounts({
    action,
    pool,
    authInstance,
    password: environment.QA_ACCOUNT_PASSWORD,
    namespace: values.namespace || environment.QA_ACCOUNT_NAMESPACE || "qa",
    companySlug: values.company || environment.QA_COMPANY_SLUG || "default",
    locationName: values.location || environment.QA_LOCATION_NAME,
  });
  logger.log(JSON.stringify({ target: safety.target, databaseHost: safety.databaseHost, ...result }, null, 2));
  return result;
}

async function main() {
  try {
    await runQaAccountCommand();
  } catch (error) {
    console.error(redactQaError(error, [process.env.QA_ACCOUNT_PASSWORD]));
    process.exitCode = 1;
  } finally {
    await closePool().catch(() => {});
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) await main();
