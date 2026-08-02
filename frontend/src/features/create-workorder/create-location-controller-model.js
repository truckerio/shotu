import {
  createLocationDefaultPatch,
  resolveCreateLocation,
  templateFieldsForCreateLocation,
} from "./create-workorder-utils.js";

export const EMPTY_CREATE_ASSIGNMENT = Object.freeze({
  error: "",
  loading: false,
  mechanicUserIds: [],
  mechanics: [],
});

export function createTemplateEndpoint(templateApiRole) {
  const role = String(templateApiRole || "").trim();
  return role ? `/api/${encodeURIComponent(role)}/template` : "";
}

export function createLocationMechanicsEndpoint(locationId) {
  const id = String(locationId || "").trim();
  return id ? `/api/office/locations/${encodeURIComponent(id)}/mechanics` : "";
}

export function normalizeCreateLocationResponse(payload = {}) {
  const locations = Array.isArray(payload.locations) ? payload.locations : [];
  const defaultLocationEntry = payload.location
    ? { location: payload.location, template: payload.template || null }
    : locations[0] || null;

  return { defaultLocationEntry, locations };
}

export function createLoadedLocationModel({ currentLocationId = "", payload = {} } = {}) {
  const { defaultLocationEntry, locations } = normalizeCreateLocationResponse(payload);
  const hadValidLocation = Boolean(resolveCreateLocation(locations, currentLocationId)?.location?.id);
  const patch = defaultLocationEntry?.location
    ? createLocationDefaultPatch({
      currentLocationId,
      defaultLocation: defaultLocationEntry.location,
      locations,
      template: defaultLocationEntry.template,
    })
    : {};

  return {
    defaultLocationEntry,
    locations,
    patch,
    resetDraftBaseline: Boolean(defaultLocationEntry?.location) && !hadValidLocation,
  };
}

export function createLocationSelectionPatch(locations = [], locationId = "") {
  const selectedLocation = resolveCreateLocation(locations, locationId);
  if (!selectedLocation?.location?.id) return null;

  return {
    locationId: selectedLocation.location.id,
    locationName: selectedLocation.location.name || "",
    ...templateFieldsForCreateLocation(selectedLocation.location, selectedLocation.template),
  };
}

export function canLoadCreateMechanics({ activeWorkorder, actorRole, selectedLocationId } = {}) {
  return !activeWorkorder
    && ["admin", "office"].includes(actorRole)
    && Boolean(String(selectedLocationId || "").trim());
}

export function createAssignmentLoadingState(current = EMPTY_CREATE_ASSIGNMENT) {
  return {
    ...current,
    error: "",
    loading: true,
    mechanicUserIds: [],
  };
}

export function createAssignmentLoadedState(mechanics = []) {
  return {
    error: "",
    loading: false,
    mechanicUserIds: [],
    mechanics: Array.isArray(mechanics) ? mechanics : [],
  };
}

export function createAssignmentClearedState(current = EMPTY_CREATE_ASSIGNMENT, error = "") {
  return {
    ...current,
    error,
    loading: false,
    mechanics: [],
  };
}
