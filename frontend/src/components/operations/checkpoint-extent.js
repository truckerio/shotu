// Unmounted batches retain their measured space; unknown batches use one stable
// row-height estimate per query/width, rather than resizing the track every load.
export function createCheckpointExtent(pageSize = 20) {
  const heights = new Map();
  let rowHeight = 0;
  let width = 0;
  let count = 0;
  let total = 0;
  function rows(page) { return Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize)); }
  function height(page) { return heights.get(page) ?? rows(page) * rowHeight; }
  return {
    measure(batches, nextCount, nextTotal, nextWidth) {
      if (Math.abs(width - nextWidth) > 1) { heights.clear(); rowHeight = 0; }
      width = nextWidth; count = nextCount; total = nextTotal;
      for (const batch of batches) {
        if (batch.rows > 0 && batch.height > 0) {
          if (!rowHeight) rowHeight = batch.height / batch.rows;
          heights.set(batch.page, batch.height);
        }
      }
    },
    offset(page) {
      let value = 0;
      for (let index = 1; index < page && index <= count; index++) value += height(index);
      return value;
    },
    spacing(first, last) {
      return { before: this.offset(first), after: Math.max(0, this.offset(count + 1) - this.offset(last + 1)) };
    },
    pageAt(offset) {
      let end = 0;
      for (let page = 1; page <= count; page++) {
        end += height(page);
        if (offset < end) return page;
      }
      return Math.max(1, count);
    },
  };
}
