export function isEligibleSerializedUnit(unit) {
  return unit.eligible !== false && unit.eligibility?.canIssue !== false && unit.canIssue !== false;
}

export function eligibleSelectedUnitIds(units, selectedUnitIds) {
  return units.filter((unit) => selectedUnitIds.has(unit.id) && isEligibleSerializedUnit(unit)).map((unit) => unit.id);
}

export function selectAllEligibleUnitIds(units) {
  return new Set(units.filter(isEligibleSerializedUnit).map((unit) => unit.id));
}

/**
 * Issues the current selection one serialized unit at a time. The caller owns
 * the key map so a failed unit retries with its original idempotency key.
 */
export async function issueSelectedSerializedUnits({
  units,
  selectedUnitIds,
  keyByUnitId,
  createKey,
  issue,
  onIssued,
}) {
  const successes = [];
  const failures = [];
  const selectedIds = eligibleSelectedUnitIds(units, selectedUnitIds);

  for (const unitId of selectedIds) {
    if (!keyByUnitId.has(unitId)) keyByUnitId.set(unitId, createKey(unitId));
    try {
      const result = await issue(unitId, keyByUnitId.get(unitId));
      await onIssued?.(result, unitId);
      successes.push(unitId);
    } catch (error) {
      failures.push({ id: unitId, error });
    }
  }

  return { successes, failures };
}
