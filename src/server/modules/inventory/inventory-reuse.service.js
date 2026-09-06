import { createHash } from "node:crypto";
import { requireActor, requireCompanyAccess, requireLocationAccess } from "../../auth/authorize.js";
import { authorizeProductModule } from "../access/product-module-access.service.js";
import { configureInventoryReuse, mutateInventoryReuse, readInventoryReuse } from "../../db/repositories/inventory-reuse.repo.js";
import { InventoryError } from "./inventory.errors.js";
import { reuseConfigReadSchema, reuseGrantSchema, reuseId, reusePolicySchema, reuseReceiveSchema, reuseRemoveSchema, reuseReviewSchema, reuseRouteSchema, reuseRepairStartSchema, reuseRepairCompleteSchema, reuseDispositionSchema, reuseQuarantineSchema, reuseCorrectionSchema, reuseLegacyTrackSchema, reuseReadSchema, reuseScopeSchema } from "./inventory-reuse.schemas.js";

const commandSchemas = { remove: reuseRemoveSchema, legacy_track: reuseLegacyTrackSchema, receive: reuseReceiveSchema, release: reuseReviewSchema, route: reuseRouteSchema, repair_start: reuseRepairStartSchema, repair_complete: reuseRepairCompleteSchema, core_return: reuseDispositionSchema, scrap: reuseDispositionSchema, quarantine_resolve: reuseQuarantineSchema, correct_location: reuseCorrectionSchema };
const capabilities = { remove: "remove", legacy_track: "remove", receive: "receive", release: "release", route: "route", repair_start: "repair", repair_complete: "repair", core_return: "disposition", scrap: "disposition", quarantine_resolve: "quarantine", correct_location: "route" };

async function authorization(input, context, dependencies, write = false) {
  requireActor(context); requireCompanyAccess(context, input.companyId); requireLocationAccess(context, input.locationId);
  if (input.action === "remove") return;
  await (dependencies.authorizeProduct || authorizeProductModule)(context, { companyId: input.companyId, locationId: input.locationId, moduleKey: "workorders" }, write ? "write" : "read");
}
function repositoryInput(input, context) { return { ...input, actorId: context.actor.id }; }
export async function commandInventoryReuse(action, caseId, rawInput, context, dependencies = {}) {
  const schema = commandSchemas[action]; if (!schema) throw new Error(`Unsupported inventory reuse action: ${action}`);
  const input = { ...schema.parse(rawInput || {}), action, capability: capabilities[action] };
  if (!['legacy_track','correct_location'].includes(action) && !input.expectedVersion) throw new InventoryError("Refresh this custody case before saving a new lifecycle action.", { code: "INVENTORY_REUSE_VERSION_REQUIRED", statusCode: 409 });
  if (action === "receive" && input.expectedVersion && !input.exactUnitId) throw new InventoryError("Confirm the exact scanned inventory unit before receiving this part.", { code: "INVENTORY_REUSE_EXACT_UNIT_REQUIRED", statusCode: 409 });
  if (["core_return", "scrap"].includes(action) && !input.externalReference) throw new InventoryError("A physical destination or return reference is required.", { code: "INVENTORY_REUSE_DESTINATION_REQUIRED", statusCode: 409 });
  if (!['remove','legacy_track','correct_location'].includes(action)) input.caseId = reuseId.parse(caseId);
  await authorization(input, context, dependencies, true);
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return (dependencies.mutate || mutateInventoryReuse)({ ...repositoryInput(input, context), requestHash });
}
export async function getInventoryReuse(view, rawInput, entityId, context, dependencies = {}) {
  const schema = view === "config"
    ? reuseConfigReadSchema
    : view === "queue" || view === "stock" || view === "units" || view === "unit" || view === "scan"
      ? reuseReadSchema
      : reuseScopeSchema;
  const input = { ...schema.parse(rawInput), view };
  if (view === "asset") input.assetId = reuseId.parse(entityId);
  if (view === "operation") input.idempotencyKey = entityId;
  if (view === "unit") input.unitId = reuseId.parse(entityId);
  if (view === "scan") input.code = String(entityId || input.code || "");
  await authorization(input, context, dependencies, false);
  return (dependencies.read || readInventoryReuse)(repositoryInput(input, context));
}
export async function saveInventoryReuseConfiguration(kind, rawInput, context, dependencies = {}) {
  const input = { ...(kind === "grant" ? reuseGrantSchema : reusePolicySchema).parse(rawInput), kind };
  await authorization(input, context, dependencies, true);
  return (dependencies.configure || configureInventoryReuse)(repositoryInput(input, context));
}
