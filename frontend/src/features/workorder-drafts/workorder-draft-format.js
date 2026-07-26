function text(value) {
  return String(value ?? "").trim();
}

function dateValue(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export function draftPayload(draft) {
  return draft?.payload && typeof draft.payload === "object" ? draft.payload : {};
}

export function draftFormData(draft) {
  const payload = draftPayload(draft);
  return payload.formData && typeof payload.formData === "object" ? payload.formData : {};
}

export function draftUnit(draft) {
  const payload = draftPayload(draft);
  const form = draftFormData(draft);
  return text(form.unitNo || payload.unitNo || payload.assetUnitNo || payload.asset?.unitNo) || "New workorder";
}

export function draftConcern(draft) {
  const payload = draftPayload(draft);
  const form = draftFormData(draft);
  return text(payload.concern || form.mechanicConcern || form.concern || payload.problem);
}

export function draftLocation(draft) {
  const payload = draftPayload(draft);
  return text(draft.location?.name || draft.locationName || payload.locationName || payload.location?.name) || "Location not selected";
}

export function draftCreator(draft) {
  return text(draft.createdBy?.name || draft.createdByName || draft.creator?.name || draft.createdByUser?.name);
}

export function draftOwner(draft) {
  return text(draft.owner?.name || draft.ownerName || draft.lastEditedBy?.name || draft.updatedBy?.name);
}

export function draftOwnerId(draft) {
  return text(draft.ownerId || draft.owner?.id || draft.claimedByUserId || draft.createdByUserId || draft.createdBy?.id);
}

export function draftMissingFields(draft) {
  const payload = draftPayload(draft);
  const form = draftFormData(draft);
  const missing = [];
  if (!draft.locationId && draftLocation(draft).startsWith("Location not")) missing.push("location");
  if (!text(payload.assetId || form.unitNo || payload.unitNo)) missing.push("unit");
  if (!draftConcern(draft)) missing.push("concern");
  if (!text(form.customerCompanyName || form.companyName || payload.customerCompanyName)) missing.push("customer");
  return missing;
}

export function draftBelongsToActor(draft, actorId) {
  return Boolean(actorId) && draftOwnerId(draft) === String(actorId);
}

export function formatDraftUpdatedAt(value, now = Date.now()) {
  const date = dateValue(value);
  if (!date) return "Not saved yet";
  const elapsed = Math.max(0, now - date.getTime());
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return "Just now";
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`;
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function formatDraftUpdatedTitle(value) {
  const date = dateValue(value);
  return date ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date) : "Not saved yet";
}

export function draftMatchesSearch(draft, search) {
  const query = text(search).toLocaleLowerCase();
  if (!query) return true;
  return [
    draftUnit(draft),
    draftConcern(draft),
    draftLocation(draft),
    draftCreator(draft),
    draftOwner(draft),
    draft.id,
  ].some((value) => value.toLocaleLowerCase().includes(query));
}
