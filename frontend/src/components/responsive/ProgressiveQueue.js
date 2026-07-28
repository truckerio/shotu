export const PROGRESSIVE_QUEUE_PAGE_SIZE = 20;

export function progressiveQueueState(total, visibleCount, compact, pageSize = PROGRESSIVE_QUEUE_PAGE_SIZE) {
  const safeTotal = Math.max(0, Number(total) || 0);
  if (!compact) {
    return {
      visibleCount: safeTotal,
      remainingCount: 0,
      nextCount: 0,
    };
  }

  const safeVisibleCount = Math.min(safeTotal, Math.max(pageSize, Number(visibleCount) || pageSize));
  const remainingCount = safeTotal - safeVisibleCount;
  return {
    visibleCount: safeVisibleCount,
    remainingCount,
    nextCount: Math.min(pageSize, remainingCount),
  };
}

export function progressiveQueueResetKey(values) {
  return JSON.stringify(values);
}
