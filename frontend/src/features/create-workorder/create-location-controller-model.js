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

export function createTemplateEndpoint() {
  return "/api/workorders/create-context";
}

export function normalizeCreateLocationResponse(payload = {}) {
  const locations = Array.isArray(payload.locations)
    ? payload.locations.map((entry) => ({
      ...entry,
      policy: entry.policy || entry.moduleAccess || null,
    }))
    : [];
  const defaultLocationEntry = payload.location
    ? {
      location: payload.location,
      mechanics: payload.mechanics || [],
      policy: payload.policy || payload.moduleAccess || null,
      template: payload.template || null,
    }
    : locations[0] || null;

  return { defaultLocationEntry, locations };
}

export function createLoadedLocationModel({ currentLocationId = "", payload = {} } = {}) {
  const { defaultLocationEntry, locations } = normalizeCreateLocationResponse(payload);
  const hadValidLocation = Boolean(resolveCreateLocation(locations, currentLocationId)?.location?.id);
  const selectedEntry = resolveCreateLocation(locations, currentLocationId) || defaultLocationEntry;
  const patch = defaultLocationEntry?.location
    ? createLocationDefaultPatch({
      currentLocationId,
      defaultLocation: defaultLocationEntry.location,
      locations,
      template: defaultLocationEntry.template,
    })
    : {};
  if (selectedEntry) patch.laborProduct = selectedEntry.laborProduct || null;

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
    laborProduct: selectedLocation.laborProduct || null,
    ...templateFieldsForCreateLocation(selectedLocation.location, selectedLocation.template),
  };
}

export function canLoadCreateMechanics({ activeWorkorder, actorRole, selectedLocationId } = {}) {
  return !activeWorkorder
    && Boolean(actorRole)
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
