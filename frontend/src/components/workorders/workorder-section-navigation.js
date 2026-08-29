function sectionRank(section, index) {
  return {
    alwaysPrimary: section.alwaysPrimary ? 1 : 0,
    ordinary: section.overflow ? 0 : 1,
    priority: Number.isFinite(Number(section.priority)) ? Number(section.priority) : 0,
    index,
  };
}

function sectionsByDisplayPriority(sections) {
  return sections
    .map((section, index) => ({ section, rank: sectionRank(section, index) }))
    .sort((left, right) => (
      right.rank.alwaysPrimary - left.rank.alwaysPrimary
      || right.rank.ordinary - left.rank.ordinary
      || right.rank.priority - left.rank.priority
      || left.rank.index - right.rank.index
    ));
}

function orderedSections(sections, selectedIds) {
  return sections.filter((section) => selectedIds.has(section.id));
}

export const WORKORDER_CORE_SECTION_IDS = Object.freeze(["unit", "concern", "schedule", "parts"]);

export function arrangeWorkorderSections(sections = [], optionalOrder = []) {
  const coreRank = new Map(WORKORDER_CORE_SECTION_IDS.map((id, index) => [id, index]));
  const optionalRank = new Map(optionalOrder.map((id, index) => [id, index]));
  return sections
    .map((section, index) => ({ section, index }))
    .sort((left, right) => {
      const leftCore = coreRank.get(left.section.id);
      const rightCore = coreRank.get(right.section.id);
      if (leftCore !== undefined || rightCore !== undefined) {
        if (leftCore === undefined) return 1;
        if (rightCore === undefined) return -1;
        return leftCore - rightCore;
      }
      const leftOptional = optionalRank.get(left.section.id);
      const rightOptional = optionalRank.get(right.section.id);
      if (leftOptional !== undefined || rightOptional !== undefined) {
        if (leftOptional === undefined) return 1;
        if (rightOptional === undefined) return -1;
        return leftOptional - rightOptional;
      }
      return left.index - right.index;
    })
    .map(({ section }, index) => ({
      ...section,
      alwaysPrimary: coreRank.has(section.id),
      overflow: coreRank.has(section.id) ? undefined : section.overflow,
      priority: sections.length - index,
    }));
}

export function optionalWorkorderSectionIds(sections = []) {
  const coreIds = new Set(WORKORDER_CORE_SECTION_IDS);
  return sections.filter(({ id }) => !coreIds.has(id)).map(({ id }) => id);
}

export function moveOptionalWorkorderSection(optionalIds = [], sectionId, direction) {
  const next = [...optionalIds];
  const currentIndex = next.indexOf(sectionId);
  const targetIndex = currentIndex + (direction === "earlier" ? -1 : 1);
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= next.length) return next;
  [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
  return next;
}

export function splitWorkorderSections(sections = [], maxPrimary = 4) {
  const limit = Math.max(0, Number(maxPrimary) || 0);
  const selectedIds = new Set(
    sectionsByDisplayPriority(sections)
      .slice(0, limit)
      .map(({ section }) => section.id),
  );

  return {
    primarySections: orderedSections(sections, selectedIds),
    overflowSections: sections.filter((section) => !selectedIds.has(section.id)),
  };
}

export function fitWorkorderSections(
  sections = [],
  {
    availableWidth = Number.POSITIVE_INFINITY,
    sectionWidths = {},
    moreWidth = 0,
  } = {},
) {
  const widthFor = (section) => Math.max(0, Number(sectionWidths[section.id]) || 0);
  const safeAvailableWidth = Math.max(0, Number(availableWidth) || 0);
  const allSectionsWidth = sections.reduce((total, section) => total + widthFor(section), 0);

  if (!Number.isFinite(availableWidth) || allSectionsWidth <= safeAvailableWidth) {
    return { primarySections: sections, overflowSections: [] };
  }

  const primaryIds = new Set();
  let remainingWidth = Math.max(0, safeAvailableWidth - Math.max(0, Number(moreWidth) || 0));

  sectionsByDisplayPriority(sections).forEach(({ section }) => {
    const sectionWidth = widthFor(section);
    if (sectionWidth <= remainingWidth) {
      primaryIds.add(section.id);
      remainingWidth -= sectionWidth;
    }
  });

  return {
    primarySections: orderedSections(sections, primaryIds),
    overflowSections: sections.filter((section) => !primaryIds.has(section.id)),
  };
}
