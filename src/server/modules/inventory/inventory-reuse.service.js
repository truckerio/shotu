import { createHash } from "node:crypto";
import { requireActor, requireCompanyAccess, requireLocationAccess } from "../../auth/authorize.js";
import { authorizeProductModule } from "../access/product-module-access.service.js";
import { authorizeWorkorderModule } from "../workorders/workorder-module-access.service.js";
import { configureInventoryReuse, mutateInventoryReuse, readInventoryReuse } from "../../db/repositories/inventory-reuse.repo.js";
import { reuseGrantSchema, reuseId, reuseKey, reusePolicySchema, reuseReceiveSchema, reuseRemoveSchema, reuseReviewSchema, reuseScopeSchema } from "./inventory-reuse.schemas.js";

async function authorization(input,context,dependencies,write = false) {
  requireActor(context);
  requireCompanyAccess(context,input.companyId);
  requireLocationAccess(context,input.locationId);
  const authorize = dependencies.authorizeProduct || authorizeProductModule;
  await authorize(context,{companyId:input.companyId,locationId:input.locationId,moduleKey:"workorders"},write ? "write" : "read");
  if (input.action === "remove") {
    await (dependencies.authorizeWorkorder || authorizeWorkorderModule)(context,input.removalWorkorderId,{moduleKey:"partsScanning",capability:"write",action:"finalize"});
  }
}
function repositoryInput(input,context,dependencies,write) {
  return {...input,actorId:context.actor.id};
}
export async function commandInventoryReuse(action,caseId,rawInput,context,dependencies = {}) {
  const schema = action === "remove" ? reuseRemoveSchema : action === "receive" ? reuseReceiveSchema : reuseReviewSchema;
  const input = {...schema.parse(rawInput),action};
  if (action !== "remove") input.caseId = reuseId.parse(caseId);
  await authorization(input,context,dependencies,true);
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return (dependencies.mutate || mutateInventoryReuse)({...repositoryInput(input,context,dependencies,true),requestHash});
}
export async function getInventoryReuse(view,rawScope,entityId,context,dependencies = {}) {
  const input = {...reuseScopeSchema.parse(rawScope),view};
  if (view === "asset") input.assetId = reuseId.parse(entityId);
  if (view === "operation") input.idempotencyKey = reuseKey.parse(entityId);
  await authorization(input,context,dependencies,false);
  return (dependencies.read || readInventoryReuse)(repositoryInput(input,context,dependencies,false));
}
export async function saveInventoryReuseConfiguration(kind,rawInput,context,dependencies = {}) {
  const input = {...(kind === "grant" ? reuseGrantSchema : reusePolicySchema).parse(rawInput),kind};
  await authorization(input,context,dependencies,true);
  return (dependencies.configure || configureInventoryReuse)(repositoryInput(input,context,dependencies,true));
}
