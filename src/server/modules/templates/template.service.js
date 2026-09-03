import { permissionDenied } from "../../auth/errors.js";
import { requireActor, requireCompanyAccess, requireLocationAccess } from "../../auth/authorize.js";
import { archiveInspectionTemplateVersion, createTemplateDefinition, createTemplateRevision, listInspectionTemplateDefinitions, publishTemplateAndAssign, publishTemplateVersion, saveTemplateAssignment, updateTemplateDraft } from "../../db/repositories/template-definitions.repo.js";
import { validateTemplateDefinition } from "./template-family.registry.js";

function adminScope(context, companyId, locationId = null) {
  const actor = requireActor(context); if (context.companyRoles?.get(companyId) !== "admin") throw permissionDenied();
  requireCompanyAccess(context, companyId); if (locationId) requireLocationAccess(context, locationId); return actor;
}
export async function createInspectionTemplate(context, input, dependencies = {}) {
  const actor = adminScope(context, input.companyId); const definition = validateTemplateDefinition("inspection", input.definition);
  return (dependencies.create || createTemplateDefinition)({ ...input, definition, actorId: actor.id });
}
export async function listInspectionTemplates(context, companyId, dependencies = {}) {
  adminScope(context, companyId);
  return (dependencies.list || listInspectionTemplateDefinitions)({ companyId });
}
export async function saveInspectionTemplateDraft(context, companyId, versionId, input, dependencies = {}) {
  adminScope(context, companyId); const definition = validateTemplateDefinition("inspection", input.definition);
  return (dependencies.update || updateTemplateDraft)({ companyId, versionId, definition, expectedVersion: input.expectedVersion });
}
export async function publishInspectionTemplate(context, companyId, versionId, expectedVersion, dependencies = {}) {
  const actor = adminScope(context, companyId); return (dependencies.publish || publishTemplateVersion)({ companyId, versionId, expectedVersion, actorId: actor.id });
}
export async function createInspectionTemplateRevision(context, companyId, versionId, expectedVersion, dependencies = {}) {
  const actor = adminScope(context, companyId); return (dependencies.createRevision || createTemplateRevision)({ companyId, versionId, expectedVersion, actorId:actor.id });
}
export async function publishAndAssignInspectionTemplate(context, companyId, versionId, expectedVersion, definitionInput, assignment, dependencies = {}) {
  const actor = adminScope(context, companyId, assignment?.locationId || null);
  const definition = validateTemplateDefinition("inspection", definitionInput);
  return (dependencies.publishAndAssign || publishTemplateAndAssign)({ companyId, versionId, expectedVersion, definition, assignment, actorId:actor.id });
}
export async function assignInspectionTemplate(context, input, dependencies = {}) {
  const actor = adminScope(context, input.companyId, input.locationId); return (dependencies.assign || saveTemplateAssignment)({ ...input, actorId: actor.id });
}
export async function archiveInspectionTemplate(context,companyId,versionId,input,dependencies={}){const actor=adminScope(context,companyId);return(dependencies.archive||archiveInspectionTemplateVersion)({...input,companyId,versionId,actorId:actor.id});}
