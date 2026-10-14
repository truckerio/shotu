const MIN_TICK_HITBOX = 10; // Visual marks can stay compact without shrinking targets.
const MAX_TICKS = 40;

export function normalizePageCount(pageCount, total = 0, pageSize = 20) {
  const explicitCount = Number(pageCount);
  if (Number.isFinite(explicitCount) && explicitCount > 0) return Math.floor(explicitCount);

  const recordCount = Math.max(0, Number(total) || 0);
  const batchSize = Math.max(1, Number(pageSize) || 20);
  return recordCount > 0 ? Math.ceil(recordCount / batchSize) : 0;
}

export function clampCheckpointPage(page, pageCount) {
  if (pageCount <= 0) return 0;
  return Math.min(pageCount, Math.max(1, Math.floor(Number(page) || 1)));
}

export function checkpointCapacity(height) {
  const measuredHeight = Math.max(MIN_TICK_HITBOX, Number(height) || MIN_TICK_HITBOX);
  return Math.max(1, Math.min(MAX_TICKS, Math.floor(measuredHeight / MIN_TICK_HITBOX)));
}

export function selectCheckpointPages(pageCount, currentPage, height) {
  const count = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (!count) return [];

  const current = clampCheckpointPage(currentPage, count);
  const capacity = Math.min(count, checkpointCapacity(height));
  if (count <= capacity) return Array.from({ length: count }, (_, index) => index + 1);
  if (capacity === 1) return [current];

  const pages = Array.from({ length: capacity }, (_, index) => (
    Math.round((index * (count - 1)) / (capacity - 1)) + 1
  ));

  if (!pages.includes(current)) {
    const replaceable = pages
      .map((page, index) => ({ distance: Math.abs(page - current), index, page }))
      .filter(({ page }) => page !== 1 && page !== count)
      .sort((left, right) => left.distance - right.distance || left.index - right.index);
    const replacement = replaceable[0]?.index ?? (current === 1 ? 0 : capacity - 1);
    pages[replacement] = current;
  }

  return [...new Set(pages)].sort((left, right) => left - right);
}

export function checkpointRecordRange(page, total = 0, pageSize = 20) {
  const recordCount = Math.max(0, Math.floor(Number(total) || 0));
  const batchSize = Math.max(1, Math.floor(Number(pageSize) || 20));
  if (!recordCount) return { start: 0, end: 0 };

  const pageCount = Math.ceil(recordCount / batchSize);
  const selectedPage = clampCheckpointPage(page, pageCount);
  const start = ((selectedPage - 1) * batchSize) + 1;
  return { start, end: Math.min(recordCount, start + batchSize - 1) };
}

export function checkpointAriaLabel(page, pageCount, total, pageSize) {
  const range = checkpointRecordRange(page, total, pageSize);
  const records = range.start ? `, records ${range.start} through ${range.end} of ${Math.max(0, Number(total) || 0)}` : "";
  return `Batch ${page} of ${pageCount}${records}`;
}

export function nextCheckpointPage(pages, activePage, key) {
  if (!pages.length) return 0;
  if (key === "Home") return pages[0];
  if (key === "End") return pages.at(-1);

  const currentIndex = Math.max(0, pages.indexOf(activePage));
  if (key === "ArrowUp") return pages[Math.max(0, currentIndex - 1)];
  if (key === "ArrowDown") return pages[Math.min(pages.length - 1, currentIndex + 1)];
  return pages[currentIndex];
}
