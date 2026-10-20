export function inlineLaborPlacement(sections = []) {
  const readable = (id) => sections.some((section) => section.id === id && ["read", "write", "required"].includes(section.access));
  if (!readable("diagnosisRepair")) return null;
  if (readable("parts")) return "parts";
  return readable("diagnosisRepair") ? "diagnosisRepair" : null;
}
