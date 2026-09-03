import { INSPECTION_TEMPLATE_FAMILY } from "../../../../shared/inspection-template.js";
import { inspectionTemplateDefinitionSchema } from "./template.schemas.js";

const registry = new Map([["inspection", Object.freeze({
  manifest: INSPECTION_TEMPLATE_FAMILY,
  definitionSchema: inspectionTemplateDefinitionSchema,
})]]);

export function getTemplateFamily(familyKey) {
  return registry.get(String(familyKey || "")) || null;
}

export function validateTemplateDefinition(familyKey, definition) {
  const family = getTemplateFamily(familyKey);
  if (!family) throw new Error("Unknown template family.");
  return family.definitionSchema.parse(definition);
}

export function listTemplateFamilies() {
  return [...registry.values()].map(({ manifest }) => manifest);
}
