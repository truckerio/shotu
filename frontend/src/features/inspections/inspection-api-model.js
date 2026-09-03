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
