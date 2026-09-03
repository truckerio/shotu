export function inspectionFromApi(record = {}) {
  const responseValues = Array.isArray(record.responses) ? record.responses : [];
  const findingsByResponse = new Map((record.findings || []).map((finding) => [finding.responseId, finding]));
  const responses = Object.fromEntries(responseValues.map((response) => {
    const finding = findingsByResponse.get(response.id) || (record.findings || []).find((entry) => entry.itemKey === response.itemKey);
    return [response.itemKey, {
      response: response.response,
      naReason: response.naReason || "",
      ...(finding ? { findingId: finding.id, severity: finding.severity, note: finding.note, disposition: finding.disposition, noWorkorderReason: finding.noWorkorderReason || "" } : {}),
    }];
  }));
  const snapshot = record.templateSnapshot;
  const template = snapshot ? {
    key: snapshot.presetKey,
    label: snapshot.label,
    sections: (snapshot.sections || []).map((section) => ({
      key: section.key,
      label: section.title,
      items: (section.items || []).map((item) => ({ ...item, naAllowed: item.allowNa, naReasonRequired: item.requireNaReason })),
    })),
  } : undefined;
  return {
    ...record,
    number: record.inspectionNumber,
    unitNo: record.asset?.unitNo || record.unitNo,
    vin: record.asset?.vin,
    plate: record.asset?.licensePlate,
    locationName: record.location?.name || record.locationName || "",
    mechanicName: record.mechanic?.name || record.mechanicName || "",
    templateLabel: snapshot?.label || record.templateLabel,
    template,
    responses,
    progress: record.progress || { answered: responseValues.length, total: (snapshot?.sections || []).flatMap((section) => section.items || []).length || 12, issues: record.defectCount || 0 },
  };
}

export function responsePayload(itemKey, value) {
  return {
    itemKey,
    response: value.response,
    naReason: value.naReason || "",
    ...(value.response === "issue" ? { finding: {
      severity: value.severity,
      note: value.note,
      disposition: value.disposition,
      noWorkorderReason: value.noWorkorderReason || "",
    } } : {}),
  };
}

export function inspectionStartPayload(inspection = {}, values = {}) {
  const payload = { expectedVersion: inspection.version, previousReportReviewed:Boolean(values.previousReportReviewed) };
  const isTrailer = String(inspection.unitType || "").trim().toLowerCase() === "trailer";
  if (isTrailer) return payload;
  payload.odometerMiles = Number(values.odometerMiles);
  const engineHours = String(values.engineHours || "").trim();
  if (engineHours) payload.engineHours = Number(engineHours);
  return payload;
}

export function authorizedSummaryWorkorders(links = []) {
  return links
    .map((link, index) => ({
      id: link.workorderId || link.workorder?.id || "",
      number: link.workorderSerial || link.workorder?.serial || "",
      createdAt: link.createdAt || link.created_at || "",
      index,
    }))
    .filter((link) => link.id && link.number)
    .sort((left, right) => left.createdAt && right.createdAt ? left.createdAt.localeCompare(right.createdAt) || left.index - right.index : left.index - right.index)
    .filter((link, index, entries) => entries.findIndex((entry) => entry.id === link.id) === index)
    .map(({ id, number }) => ({ id, number }));
}

export function openInspectionFollowUps({ findings = [], followUps = [] } = {}) {
  const notes = new Map(findings.map((finding) => {
    const note = String(finding.note || "").trim() || "Finding details pending";
    return [finding.id, note.length > 240 ? `${note.slice(0, 237)}…` : note];
  }));
  return followUps
    .filter((followUp) => ["open", "reopened"].includes(followUp.status) && followUp.findingId && Number.isInteger(Number(followUp.version)) && Number(followUp.version) > 0)
    .map((followUp) => ({
      id: followUp.id || followUp.findingId,
      findingId: followUp.findingId,
      note: notes.get(followUp.findingId) || "Finding details pending",
      status: followUp.status,
      version: Number(followUp.version),
    }));
}

export const MAX_LIVE_INSPECTION_ROWS = 250;
export const INSPECTION_RECONCILE_EVERY_CYCLES = 20;

export function inspectionRefreshMode(cycle) {
  return cycle > 0 && cycle % INSPECTION_RECONCILE_EVERY_CYCLES === 0 ? "reconcile" : "fast";
}

export function mergeFastInspectionPage(currentItems = [], refreshedItems = []) {
  const refreshedIds = new Set(refreshedItems.map((item) => item.id));
  return [...refreshedItems, ...currentItems.filter((item) => !refreshedIds.has(item.id))].slice(0, MAX_LIVE_INSPECTION_ROWS);
}

export async function loadInspectionRefreshWindow(fetchPage, { loadedCount = 25, pageSize = 50 } = {}) {
  const targetCount = Math.min(MAX_LIVE_INSPECTION_ROWS, Math.max(1, loadedCount));
  const items = [];
  let cursor = "";
  let nextCursor = "";
  do {
    const page = await fetchPage({ cursor, limit: Math.min(pageSize, targetCount - items.length) });
    items.push(...(page.items || []));
    nextCursor = page.nextCursor || "";
    cursor = nextCursor;
  } while (items.length < targetCount && cursor);
  return { items, nextCursor };
}
