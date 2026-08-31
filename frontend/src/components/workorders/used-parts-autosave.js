export function createUsedPartsAutosave({
  clearTimer = globalThis.clearTimeout,
  delay = 750,
  onError = () => {},
  onSaved = () => {},
  onSaving = () => {},
  onStoreDraft = () => {},
  save,
  setTimer = globalThis.setTimeout,
}) {
  let baseline = "";
  let disposed = false;
  let inFlight = null;
  let latest = null;
  let revision = 0;
  let session = 0;
  let timer = null;

  function clearPendingTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function isCurrent(snapshot, snapshotSession) {
    return !disposed && session === snapshotSession && latest?.revision === snapshot.revision;
  }

  async function persist(snapshotSession = session) {
    clearPendingTimer();
    if (disposed || snapshotSession !== session || !save) return false;
    if (!latest || latest.payload === baseline) return true;
    if (inFlight) return inFlight.then(() => persist(snapshotSession));

    const request = (async () => {
      let result = true;
      while (!disposed && snapshotSession === session && latest && latest.payload !== baseline) {
        const snapshot = latest;
        onSaving(true);
        try {
          const saved = await save(snapshot.rows, snapshot.revision);
          if (isCurrent(snapshot, snapshotSession)) {
            baseline = snapshot.payload;
            latest = null;
            onSaved(snapshot.rows, snapshot.revision, saved);
            break;
          }
        } catch (error) {
          result = false;
          if (snapshotSession === session && !disposed) onError(error, snapshot.revision);
          break;
        } finally {
          if (snapshotSession === session && !disposed) onSaving(false);
        }
      }
      return result;
    })();
    inFlight = request;
    try {
      return await request;
    } finally {
      if (inFlight === request) inFlight = null;
    }
  }

  function update(rows) {
    if (disposed) return;
    const payload = JSON.stringify({ parts: rows });
    if (payload === latest?.payload || payload === baseline) return;
    const snapshot = { payload, revision: ++revision, rows };
    latest = snapshot;
    onStoreDraft(rows, snapshot.revision);
    clearPendingTimer();
    const snapshotSession = session;
    timer = setTimer(() => {
      timer = null;
      persist(snapshotSession);
    }, Math.max(0, delay));
  }

  function flush() {
    return persist();
  }

  function reset(rows) {
    clearPendingTimer();
    session += 1;
    baseline = JSON.stringify({ parts: rows });
    latest = null;
    revision = 0;
  }

  function hasPending() {
    return Boolean(latest || inFlight || timer !== null);
  }

  function dispose() {
    clearPendingTimer();
    disposed = true;
    session += 1;
    latest = null;
  }

  return { dispose, flush, hasPending, reset, update };
}
