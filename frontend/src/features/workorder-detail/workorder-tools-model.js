const SUPPORTING_MODULES = new Set(["chat", "photos", "activity", "completion", "odoo", "preview"]);

// Layout only: callers supply policy-filtered sections. Never grant module access here.
export function mainWorkorderSections(sections = []) {
  return sections.filter((section) => !SUPPORTING_MODULES.has(section.id));
}

export function requestedWorkorderTool(section) {
  if (section === "photos") return "chat";
  return SUPPORTING_MODULES.has(section) ? section : null;
}
