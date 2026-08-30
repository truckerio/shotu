export function createSerializedRepairAutosave({
  clearTimer = globalThis.clearTimeout,
  delay = 500,
  onError = () => {},
  onSaved = () => {},
  onSaving = () => {},
  save,
  setTimer = globalThis.setTimeout,
}) {
  const drafts = new Map();
  const timers = new Map();
  const saves = new Map();
  const saveValues = new Map();

  function current(usageId) {
    return drafts.get(usageId)?.repairOrder;
  }

  function persist(part, repairOrder) {
    if (!part?.usageId) return Promise.resolve(true);
    clearTimer(timers.get(part.usageId));
    timers.delete(part.usageId);
    if (saveValues.get(part.usageId) === repairOrder && saves.has(part.usageId)) {
      return saves.get(part.usageId);
    }
    const prior = saves.get(part.usageId) || Promise.resolve(true);
    const request = prior.then(async () => {
      if (current(part.usageId) !== repairOrder) return true;
      onSaving(part.usageId, true);
      try {
        await save(part, repairOrder);
        if (current(part.usageId) === repairOrder) {
          drafts.delete(part.usageId);
          onSaved(part.usageId, repairOrder);
        }
        return true;
      } catch (error) {
        onError(error);
        return false;
      } finally {
        onSaving(part.usageId, false);
      }
    });
    saves.set(part.usageId, request);
    saveValues.set(part.usageId, repairOrder);
    request.then(() => {
      if (saves.get(part.usageId) === request) {
        saves.delete(part.usageId);
        saveValues.delete(part.usageId);
      }
    });
    return request;
  }

  function update(part, repairOrder) {
    if (!part?.usageId) return;
    drafts.set(part.usageId, { part, repairOrder });
    clearTimer(timers.get(part.usageId));
    timers.set(part.usageId, setTimer(() => persist(part, repairOrder), delay));
  }

  function flushOne(part) {
    const pending = drafts.get(part?.usageId);
    return pending ? persist(pending.part, pending.repairOrder) : Promise.resolve(true);
  }

  async function flushAll() {
    const pending = [...drafts.values()].map(({ part, repairOrder }) => persist(part, repairOrder));
    const active = [...saves.values()];
    const results = await Promise.all([...new Set([...pending, ...active])]);
    return results.every(Boolean);
  }

  function dispose() {
    timers.forEach((timer) => clearTimer(timer));
    timers.clear();
  }

  return { current, dispose, flushAll, flushOne, update };
}
