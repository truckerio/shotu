// Native scrolling stays untouched. Coalesce bookkeeping to one read pass per frame.
export function createCheckpointScrollWork({ onFrame, onPersist, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let frame = null;
  let timer = null;
  let hint = 0;
  let pending = null;
  function flushPersistence() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (pending) { const value = pending; pending = null; onPersist(value); }
  }
  function flushFrame() {
    if (frame === null) return;
    cancelFrame(frame);
    frame = null;
    const direction = hint;
    hint = 0;
    onFrame(direction);
  }
  return {
    schedule(direction = 0) {
      hint = direction;
      if (frame === null) frame = requestFrame(() => {
        frame = null;
        const direction = hint;
        hint = 0;
        onFrame(direction);
      });
    },
    persist(value) {
      pending = value;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(flushPersistence, 160);
    },
    flush() { flushFrame(); flushPersistence(); },
    dispose() {
      if (frame !== null) cancelFrame(frame);
      frame = null;
      flushPersistence();
    },
  };
}

export function firstVisibleCheckpointRow(rows, top) {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (rows[middle].getBoundingClientRect().bottom > top + 1) high = middle;
    else low = middle + 1;
  }
  return rows[low] || null;
}

export function checkpointPrefetchDistance(view) {
  return Math.max(1200, (view.bottom - view.top) * 2);
}
