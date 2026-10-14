export const INSPECTION_RESPONSES = ["pass", "issue", "na"];

export function inspectionTemplateFromApi(record) {
  return {
    id: record.version.id,
    definitionId: record.id,
    versionId: record.version.id,
    optimisticVersion: record.version.optimisticVersion,
    name: record.name,
    unitType: record.applicabilityKey,
    sourcePreset: record.presetKey,
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
    label: template.name, assetType: template.unitType,
    schemaVersion: 1, rendererVersion: "inspection-slip-v1",
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

const WEEKLY_TRUCK_SECTIONS = [
  ["Outside", ["Lights and reflectors", "Tires and tire condition/pressure", "Wheels, rims, hubs, and lug nuts", "Mirrors, windshield, and wipers"]],
  ["Mechanical", ["Brakes and visible air or hydraulic leaks", "Steering", "Suspension", "Engine fluids and visible leaks", "Belts and hoses"]],
  ["Safety", ["Fifth wheel and coupling equipment", "Frame and body condition", "Horn and emergency equipment"]],
];
const WEEKLY_TRAILER_SECTIONS = [
  ["Outside", ["Lights and reflectors", "Tires", "Wheels, rims, hubs, and lug nuts", "Body, doors, roof, and floor"]],
  ["Mechanical", ["Brakes, air lines, and ABS indication", "Kingpin and coupling condition", "Electrical connection", "Suspension and axles", "Landing gear"]],
  ["Safety", ["Frame and crossmembers", "Mudflaps and rear-impact guard", "Cargo securement equipment"]],
];

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "check";
}

function makeSections(rows) {
  return rows.map(([title, checks]) => ({
    id: slug(title), title,
    checks: checks.map((label) => ({ id: slug(label), label, allowedResponses: [...INSPECTION_RESPONSES] })),
  }));
}

export const INSPECTION_PRESETS = Object.freeze([
  { id: "weekly-truck", name: "Weekly Truck Inspection", unitType: "Truck", sections: makeSections(WEEKLY_TRUCK_SECTIONS) },
  { id: "weekly-trailer", name: "Weekly Trailer Inspection", unitType: "Trailer", sections: makeSections(WEEKLY_TRAILER_SECTIONS) },
]);

export function cloneInspectionTemplate(template) {
  return { ...template, sections: (template.sections || []).map((section) => ({ ...section, checks: (section.checks || []).map((check) => ({ ...check, allowedResponses: [...(check.allowedResponses || INSPECTION_RESPONSES)] })) })) };
}

export function createInspectionTemplate(presetId = "weekly-truck", id = `inspection-${Date.now()}`) {
  const preset = INSPECTION_PRESETS.find((item) => item.id === presetId);
  if (!preset) return { id, name: "Untitled weekly inspection", unitType: "Truck", status: "draft", sections: [] };
  return { ...cloneInspectionTemplate(preset), id, status: "draft", sourcePreset: preset.id };
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
