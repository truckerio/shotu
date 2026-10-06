import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const functionBody = (source, start, end) => source.slice(
  source.indexOf(start),
  end ? source.indexOf(end, source.indexOf(start) + start.length) : source.length,
);

test("all canonical Workorder repair-progress repositories use the shared Estimate gate", () => {
  const operational = read("./operational-workorders.repo.js");
  const progress = read("./workorder-progress.repo.js");
  const serialized = read("./inventory-unit-workorder-usage.repo.js");
  const aggregate = read("./inventory-aggregate-workorder-usage.repo.js");

  for (const source of [operational, progress, serialized, aggregate]) {
    assert.match(source, /import[\s\S]*assertCurrentExternalEstimateAccepted[\s\S]*from "\.\/workorder-customer-authorization\.repo\.js"/);
  }

  assert.match(functionBody(operational, "export async function updateOperationalWorkorder", "export async function deleteOperationalWorkorder"), /changesRepairProgress[\s\S]*assertCurrentExternalEstimateAccepted/);
  assert.match(functionBody(operational, "export async function updateOperationalWorkorder", "export async function deleteOperationalWorkorder"), /hasNestedLaborHours[\s\S]*laborHoursIncluded = hasTopLevelLaborHours \|\| hasNestedLaborHours/);
  assert.match(functionBody(operational, "async function updateOperationalUsedParts", "async function activeSerializedRepairOrders"), /if \(changes\.length\) \{[\s\S]*assertCurrentExternalEstimateAccepted[\s\S]*update operational_workorders/);
  assert.match(functionBody(operational, "export async function markOperationalWorkorderDone", "export async function returnOperationalWorkorder"), /for update[\s\S]*assertCurrentExternalEstimateAccepted[\s\S]*markAggregateUsagesPending/);
  assert.match(functionBody(operational, "export async function closeOperationalWorkorder", "export async function markOperationalWorkorderOdooEntered"), /for update[\s\S]*assertCurrentExternalEstimateAccepted[\s\S]*consumePendingSerializedInstallationsForApproval[\s\S]*consumeAggregateUsagesForApproval/);
  assert.match(functionBody(progress, "export async function saveMechanicWorkorderProgress", ""), /for update of wo[\s\S]*assertCurrentExternalEstimateAccepted[\s\S]*update operational_workorders/);

  const opened = functionBody(operational, "export async function recordWorkorderOpened", "export async function getWorkorderTimeline");
  assert.match(opened, /select id, company_id, status, started_at[\s\S]*for update/);
  assert.match(opened, /if \(assignment\.rows\[0\]\) \{[\s\S]*assertCurrentExternalEstimateAccepted[\s\S]*set status = \$2, started_at = now\(\)/);

  const partRequests = read("./part-requests.repo.js");
  const restoreAfterParts = functionBody(partRequests, "async function restoreWorkorderWhenResolved", "export async function decidePartRequest");
  assert.match(partRequests, /import \{ assertCurrentExternalEstimateAccepted \} from "\.\/workorder-customer-authorization\.repo\.js"/);
  assert.match(restoreAfterParts, /const nextStatus[\s\S]*assertCurrentExternalEstimateAccepted[\s\S]*setWorkorderStatus/);
  assert.match(functionBody(partRequests, "export async function decidePartRequest", "async function markLegacyAllocationReconciliation"), /company_id: request\.company_id[\s\S]*restoreWorkorderWhenResolved/);

  assert.match(functionBody(serialized, "export async function updateSerializedUsageRepairOrder", "async function lockWorkorder"), /assertCurrentExternalEstimateAccepted[\s\S]*update workorder_serialized_part_usages/);
  assert.match(functionBody(serialized, "export async function issueSerializedUnitToWorkorder", "export async function finalizeSerializedUnitUsage"), /lockWorkorder[\s\S]*assertCurrentExternalEstimateAccepted[\s\S]*insert into workorder_serialized_part_usages/);
  const finalize = functionBody(serialized, "export async function finalizeSerializedUnitUsage", "export async function consumePendingSerializedInstallationsForApproval");
  assert.match(finalize, /if \(input\.disposition === "installed"\) \{[\s\S]*assertCurrentExternalEstimateAccepted/);
  assert.doesNotMatch(finalize, /if \(input\.disposition === "returned"\) \{[\s\S]{0,220}assertCurrentExternalEstimateAccepted/);

  assert.match(functionBody(aggregate, "export async function reserveAggregateWorkorderUsage", "export async function releaseOrReverseAggregateWorkorderUsage"), /for update of workorder[\s\S]*assertCurrentExternalEstimateAccepted[\s\S]*quantity_reserved=quantity_reserved\+\$3/);
  const lifecycle = functionBody(aggregate, "export async function releaseOrReverseAggregateWorkorderUsage", "export async function markAggregateUsagesPending");
  assert.match(lifecycle, /if \(consumptionDelta > 0\) \{[\s\S]*assertCurrentExternalEstimateAccepted/);
  assert.match(lifecycle, /input\.action === "release"[\s\S]*releaseAggregateInventoryPositions/);
  assert.match(lifecycle, /input\.action === "reverse"[\s\S]*reverseAggregateCostLayers/);
});
