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
