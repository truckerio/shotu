import { closePool, getPool } from "../../../src/server/db/pool.js";
import { auth } from "../../../src/server/auth/auth.js";
import { manageQaAccounts } from "../qa-accounts-service.js";
import { redactQaError } from "../safety.js";
import { RoleApiClient } from "./api-client.js";
import { assertCriticalRoleSurfaces } from "./browser-assertions.js";
import { parseRoleWorkflowConfig, publicRoleWorkflowConfig } from "./config.js";
import { runApiRoleWorkflow } from "./workflow.js";

async function provisionDeterministicAccounts(config) {
  if (!config.provisionAccounts) return;
  const accountOptions = {
    pool: getPool(),
    authInstance: auth,
    password: config.password,
    namespace: config.namespace,
    companySlug: config.companySlug,
    locationName: config.locationName,
  };
  await manageQaAccounts({ action: "apply", ...accountOptions });
  await manageQaAccounts({ action: "reset", ...accountOptions });
  await closePool();
}

async function createRoleClients(config) {
  return Object.fromEntries(await Promise.all(
    Object.keys(config.accounts).map(async (role) => [
      role,
      await RoleApiClient.create({
        role,
        baseUrl: config.baseUrl,
        timeoutMs: config.requestTimeoutMs,
      }),
    ]),
  ));
}

async function disposeRoleClients(clients) {
  await Promise.all(Object.values(clients).map((client) => client.dispose().catch(() => {})));
}

export async function runRoleWorkflow({ environment = process.env, argv = process.argv.slice(2), logger = console } = {}) {
  const config = parseRoleWorkflowConfig(environment, argv);
  logger.log(JSON.stringify(publicRoleWorkflowConfig(config), null, 2));
  await provisionDeterministicAccounts(config);

  const clients = await createRoleClients(config);
  try {
    const workflow = await runApiRoleWorkflow({ clients, config, logger });
    const browserAssertions = config.browser.enabled
      ? await assertCriticalRoleSurfaces({ config, workflow })
      : [];
    const result = {
      passed: true,
      runId: workflow.runId,
      workorderId: workflow.workorderId,
      serial: workflow.serial,
      stages: workflow.trace.map((item) => item.stage),
      browserAssertions,
    };
    logger.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await disposeRoleClients(clients);
    await closePool().catch(() => {});
  }
}

try {
  await runRoleWorkflow();
} catch (error) {
  console.error(redactQaError(error, [process.env.QA_ACCOUNT_PASSWORD]));
  process.exitCode = 1;
  await closePool().catch(() => {});
}
