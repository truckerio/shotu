import { INSPECTION_TYPES, INSPECTION_PRINT_LAYOUTS, INSPECTION_RENDERER_VERSION, INSPECTION_ANNUAL_RENDERER_VERSION, renderInspectionSlip, INSPECTION_PRESETS as CANONICAL_INSPECTION_PRESETS } from "../../../../../shared/inspection-template.js";

export { INSPECTION_TYPES, INSPECTION_PRINT_LAYOUTS };
export const INSPECTION_RESPONSES = ["pass", "issue", "na"];

export function inspectionTemplateFromApi(record) {
  return {
    id: record.version.id,
    definitionId: record.id,
    versionId: record.version.id,
    optimisticVersion: record.version.optimisticVersion,
    name: record.name,
    unitType: record.applicabilityKey,
    sourcePreset: record.version.definition.presetKey || record.presetKey,
    inspectionType: record.version.definition.inspectionType || record.inspectionType || "weekly",
    rendererVersion: record.version.definition.rendererVersion || INSPECTION_RENDERER_VERSION,
    ...(record.version.definition.printLayout === undefined ? {} : { printLayout: record.version.definition.printLayout }),
    status: record.version.state,
    sections: (record.version.definition.sections || []).map((section) => ({
      id: section.key, title: section.title,
      checks: (section.items || []).map((item) => ({
        id: item.key, label: item.label,
        required: item.required ?? true,
        allowNa: item.allowNa ?? true,
        requireNaReason: item.requireNaReason ?? false,
        allowedResponses: item.allowNa === false ? ["pass", "issue"] : [...INSPECTION_RESPONSES],
      })),
    })),
  };
}

export function inspectionTemplateDefinition(template) {
  return {
    familyKey: "inspection", presetKey: template.sourcePreset || "custom",
    label: template.name, assetType: template.unitType, inspectionType: template.inspectionType || "weekly",
    schemaVersion: 1, rendererVersion: template.rendererVersion || INSPECTION_RENDERER_VERSION,
    ...(template.printLayout === undefined ? {} : { printLayout: template.printLayout }),
    sections: template.sections.map((section) => ({
      key: section.id, title: section.title,
      items: section.checks.map((check) => ({
        key: check.id, label: check.label,
        required: check.required ?? true,
        allowNa: check.allowNa ?? true,
        requireNaReason: check.requireNaReason ?? false,
      })),
    })),
  };
}

export const INSPECTION_PRESETS = Object.freeze(CANONICAL_INSPECTION_PRESETS.map((preset) => ({
  id: preset.presetKey === "custom" ? `custom-${preset.assetType.toLowerCase()}` : preset.presetKey, name: preset.label, unitType: preset.assetType,
  inspectionType: preset.inspectionType || "weekly",
  rendererVersion: preset.rendererVersion,
  ...(preset.printLayout === undefined ? {} : { printLayout: preset.printLayout }),
  sections: preset.sections.map((section) => ({
    id: section.key, title: section.title,
    checks: section.items.map((item) => ({
      id: item.key, label: item.label, required: item.required ?? true,
      allowNa: item.allowNa ?? true, requireNaReason: item.requireNaReason ?? false,
      allowedResponses: item.allowNa === false ? ["pass", "issue"] : [...INSPECTION_RESPONSES],
    })),
  })),
})));

export function inspectionTypeLabel(type = "weekly") {
  return INSPECTION_TYPES.find((entry) => entry.key === type)?.label || type;
}

export function matchingInspectionAssignments(assignments, { locationId = null, unitType, inspectionType = "weekly" }) {
  return assignments.filter((entry) => (entry.locationId || null) === (locationId || null)
    && (entry.applicabilityKey || entry.unitType) === unitType
    && (entry.inspectionType || "weekly") === inspectionType);
}

export function eligibleInspectionTemplates(templates, { unitType, inspectionType = "weekly", excludeVersionId }) {
  return templates.filter((entry) => entry.status === "published" && entry.unitType === unitType
    && (entry.inspectionType || "weekly") === inspectionType && (!excludeVersionId || entry.versionId !== excludeVersionId));
}

export function changeInspectionType(template, inspectionType) {
  const preset = INSPECTION_PRESETS.find((entry) => entry.id === template.sourcePreset);
  return { ...template, inspectionType, sourcePreset: preset?.inspectionType === inspectionType ? template.sourcePreset : "custom" };
}

export function changeInspectionPrintLayout(template, printLayout) {
  return { ...template, printLayout, rendererVersion: printLayout === "annual_report" ? INSPECTION_ANNUAL_RENDERER_VERSION : INSPECTION_RENDERER_VERSION };
}

export function inspectionTemplatePreviewHtml(template) {
  return renderInspectionSlip({
    inspectionNumber: "Preview", status: "in_progress", result: null,
    templateLabel: template.name, templateSnapshot: inspectionTemplateDefinition(template),
    unit: { unitNo: "Sample unit" }, responses: [], findings: [], finalNotes: "",
  });
}

export function cloneInspectionTemplate(template) {
  return { ...template, sections: (template.sections || []).map((section) => ({ ...section, checks: (section.checks || []).map((check) => ({ ...check, allowedResponses: [...(check.allowedResponses || INSPECTION_RESPONSES)] })) })) };
}

export function createInspectionTemplate(presetId = "weekly-truck", id = `inspection-${Date.now()}`) {
  const preset = INSPECTION_PRESETS.find((item) => item.id === presetId);
  if (!preset) return { id, name: "Untitled inspection", unitType: presetId === "custom-trailer" ? "Trailer" : "Truck", inspectionType: "custom", sourcePreset: "custom", status: "draft", sections: [] };
  return { ...cloneInspectionTemplate(preset), id, status: "draft", sourcePreset: preset.inspectionType === "custom" ? "custom" : preset.id };
}

export function inspectionTemplateSummary(template) {
  const sections = template?.sections || [];
  const checks = sections.reduce((count, section) => count + (section.checks || []).length, 0);
  return `${sections.length} section${sections.length === 1 ? "" : "s"} · ${checks} check${checks === 1 ? "" : "s"}`;
}

export function moveInspectionItem(items, fromIndex, toIndex) {
  if (!Array.isArray(items) || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function validateInspectionTemplate(template) {
  const errors = [];
  if (!INSPECTION_TYPES.some((entry) => entry.key === (template?.inspectionType || "weekly"))) errors.push("Choose an inspection type.");
  if (!template?.name?.trim()) errors.push("Add a template name.");
  if (!template?.sections?.length) errors.push("Add at least one section.");
  (template?.sections || []).forEach((section, sectionIndex) => {
    if (!section.title?.trim()) errors.push(`Name section ${sectionIndex + 1}.`);
    if (!section.checks?.length) errors.push(`Add a check to ${section.title || `section ${sectionIndex + 1}`}.`);
    (section.checks || []).forEach((check, checkIndex) => {
      if (!check.label?.trim()) errors.push(`Name check ${checkIndex + 1} in ${section.title || `section ${sectionIndex + 1}`}.`);
      if (!(check.allowedResponses || []).includes("pass") || !(check.allowedResponses || []).includes("issue") || (check.allowNa !== false && !(check.allowedResponses || []).includes("na"))) errors.push("Each check must allow Pass, Issue, and N/A unless N/A is disabled.");
    });
  });
  return errors;
}
