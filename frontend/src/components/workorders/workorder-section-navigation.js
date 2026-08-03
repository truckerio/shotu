export function isPrimarySectionPointer(event) {
  return event?.isPrimary !== false && Number(event?.button ?? 0) === 0;
}

export function shouldHandleSectionClick({ handledPointerSection = "", sectionId = "" } = {}) {
  return !handledPointerSection || handledPointerSection !== sectionId;
}
