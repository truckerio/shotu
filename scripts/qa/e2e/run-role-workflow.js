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
  const staleAdmin = await RoleApiClient.create({
    role: "admin",
    baseUrl: config.baseUrl,
    timeoutMs: config.requestTimeoutMs,
  });
  try {
    await staleAdmin.authenticate(config.accounts.admin);
    await manageQaAccounts({ action: "reset", ...accountOptions });
    const staleSession = await staleAdmin.request("/api/me", { expectedStatuses: [401] });
    if (staleSession.status !== 401) throw new Error("QA account reset did not revoke the existing session.");
  } finally {
    await staleAdmin.dispose().catch(() => {});
    await closePool();
  }
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
  const cleanupWorkorderIds = new Set();
  let workflow;
  try {
    workflow = await runApiRoleWorkflow({
      clients,
      config,
      logger,
      onCleanupFixture: (workorderId) => cleanupWorkorderIds.add(workorderId),
    });
    for (const workorderId of workflow.cleanupWorkorderIds || []) cleanupWorkorderIds.add(workorderId);
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
    for (const workorderId of cleanupWorkorderIds) {
      await clients.admin.request(`/api/office/workorders/${workorderId}/cancel`, {
        method: "POST",
        body: { reason: "QA role workflow fixture cleanup" },
      }).catch((error) => logger.warn(`[role-workflow] cleanup failed: ${error.message}`));
    }
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
