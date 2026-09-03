import { closePool } from "../../../src/server/db/pool.js";
import { redactQaError } from "../safety.js";
import { RoleApiClient } from "./api-client.js";
import { assertInspectionBrowserJourney } from "./inspection-browser-assertions.js";
import { parseInspectionWorkflowConfig, publicInspectionWorkflowConfig } from "./inspection-config.js";
import { requiredCapabilityHook, runApiInspectionWorkflow } from "./inspection-workflow.js";

async function createClient(config, role) { return RoleApiClient.create({ role, baseUrl: config.baseUrl, timeoutMs: config.requestTimeoutMs }); }
async function disposeClients(clients) { await Promise.all(Object.values(clients).map((client) => client?.dispose().catch(() => {}))); }

export async function runInspectionWorkflow({ environment = process.env, argv = process.argv.slice(2), logger = console } = {}) {
  const config = parseInspectionWorkflowConfig(environment, argv);
  logger.log(JSON.stringify(publicInspectionWorkflowConfig(config), null, 2));
  const clients = Object.fromEntries(await Promise.all(Object.keys(config.accounts).map(async (role) => [role, await createClient(config, role)])));
  let workflow;
  const cleanupWorkorderIds = new Set();
  try {
    workflow = await runApiInspectionWorkflow({ clients, config, createClient: (role) => createClient(config, role), logger, onWorkorderFixture: (id) => cleanupWorkorderIds.add(id) });
    const browserAssertions = config.browser.enabled ? await assertInspectionBrowserJourney({ config, inspectionNumber: workflow.inspectionNumber, trailerInspectionNumber: workflow.trailerInspectionNumber, workorderNumber: workflow.workorderNumber }) : [];
    for (const capability of workflow.capabilities) requiredCapabilityHook(capability);
    const result = { passed: true, inspectionId: workflow.inspectionId, stages: workflow.trace.map((entry) => entry.stage), browserAssertions };
    logger.log(JSON.stringify(result, null, 2)); return result;
  } finally {
    if (workflow?.workorderId) cleanupWorkorderIds.add(workflow.workorderId);
    for (const workorderId of cleanupWorkorderIds) await clients.admin.request(`/api/office/workorders/${encodeURIComponent(workorderId)}/cancel`, { method: "POST", body: { reason: "QA inspection workflow reversible fixture cleanup" } }).catch((error) => logger.warn(`[inspection-workflow] workorder cleanup failed: ${error.message}`));
    await disposeClients(clients); await closePool().catch(() => {});
  }
}

try { await runInspectionWorkflow(); } catch (error) { console.error(redactQaError(error, [process.env.QA_ACCOUNT_PASSWORD])); process.exitCode = 1; await closePool().catch(() => {}); }
