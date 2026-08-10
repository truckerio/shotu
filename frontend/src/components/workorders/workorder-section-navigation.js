export function splitWorkorderSections(sections = [], maxPrimary = 4) {
  const explicitlyPrimary = sections.filter((section) => !section.overflow);
  const primarySections = explicitlyPrimary.slice(0, maxPrimary);
  const primaryIds = new Set(primarySections.map((section) => section.id));
  explicitlyPrimary.forEach((section) => {
    if (section.alwaysPrimary && !primaryIds.has(section.id)) {
      primarySections.push(section);
      primaryIds.add(section.id);
    }
  });
  return {
    primarySections,
    overflowSections: sections.filter((section) => !primaryIds.has(section.id)),
  };
}
