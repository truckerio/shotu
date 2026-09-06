export function custodyExpectedVersion(caseItem = {}, detail = {}) {
  return (
    caseItem.caseVersion ??
    caseItem.version ??
    detail?.case?.caseVersion ??
    detail?.case?.version
  );
}

export function custodyRoute(value) {
  return value === "inspect_reuse" ? "inspect_for_reuse" : value;
}

export function custodyCommandBody({
  action,
  scope,
  caseItem,
  detail,
  draft,
  exactIdentityId,
  idempotencyKey,
}) {
  const body = {
    ...scope,
    expectedVersion: custodyExpectedVersion(caseItem, detail),
    idempotencyKey,
    evidence: draft.evidence.trim(),
  };
  if (action === "return") {
    delete body.evidence;
    Object.assign(body, {
      exactUnitId: exactIdentityId,
      outcome: draft.outcome,
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    });
  }
  if (action === "release") {
    delete body.evidence;
    Object.assign(body, {
      decision: "release",
      inspectionEvidence: draft.evidence.trim(),
      reason: draft.reason.trim(),
      ...(draft.binLocation.trim()
        ? { binLocation: draft.binLocation.trim() }
        : {}),
    });
  }
  if (action === "quarantine/resolve")
    Object.assign(body, { resolution: custodyRoute(draft.route) });
  if (["core-return", "scrap"].includes(action))
    Object.assign(body, {
      externalReference: draft.externalReference.trim(),
      dispositionDate: draft.dispositionDate,
    });
  return body;
}

export function custodyRecoveryKey({ actorId, companyId, locationId, caseId }) {
  return `inventory-custody-recovery:${actorId}:${companyId}:${locationId}:${caseId}`;
}

export function readCustodyRecovery(storage, scope) {
  try {
    const value = JSON.parse(
      storage?.getItem(custodyRecoveryKey(scope)) || "null",
    );
    return value?.path && value?.body ? value : null;
  } catch {
    return null;
  }
}

export function saveCustodyRecovery(storage, scope, request) {
  try {
    storage?.setItem(custodyRecoveryKey(scope), JSON.stringify(request));
    return true;
  } catch {
    return false;
  }
}
export function clearCustodyRecovery(storage, scope) {
  try {
    storage?.removeItem(custodyRecoveryKey(scope));
    return true;
  } catch {
    return false;
  }
}
