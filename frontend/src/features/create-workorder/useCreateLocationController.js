import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../lib/api.js";
import { createLocationTemplatePatch, resolveCreateLocation } from "./create-workorder-utils.js";
import {
  EMPTY_CREATE_ASSIGNMENT,
  canLoadCreateMechanics,
  createAssignmentClearedState,
  createAssignmentLoadedState,
  createAssignmentLoadingState,
  createLoadedLocationModel,
  createLocationSelectionPatch,
  createTemplateEndpoint,
} from "./create-location-controller-model.js";

const EMPTY_CALLBACK = () => {};

export function useCreateLocationController({
  activeWorkorder = null,
  actorRole = "",
  currentForm = {},
  request = api,
  workspace = "",
  onClearLocationError = EMPTY_CALLBACK,
  onFormPatch = EMPTY_CALLBACK,
  onSelectionPatch = EMPTY_CALLBACK,
} = {}) {
  const callbacksRef = useRef({ onClearLocationError, onFormPatch, onSelectionPatch });
  const currentFormRef = useRef(currentForm);
  callbacksRef.current = { onClearLocationError, onFormPatch, onSelectionPatch };
  currentFormRef.current = currentForm;

  const [locations, setLocations] = useState([]);
  const [locationsState, setLocationsState] = useState({
    error: "",
    loading: !activeWorkorder && workspace === "generator",
  });
  const [assignment, setAssignment] = useState(EMPTY_CREATE_ASSIGNMENT);

  const selectedLocation = useMemo(
    () => resolveCreateLocation(locations, currentForm.locationId),
    [currentForm.locationId, locations],
  );

  const reloadLocations = useCallback(async () => {
    if (activeWorkorder || workspace !== "generator") {
      setLocations([]);
      setLocationsState({ error: "", loading: false });
      return null;
    }

    setLocationsState({ error: "", loading: true });
    try {
      const payload = await request(createTemplateEndpoint());
      const model = createLoadedLocationModel({
        currentLocationId: currentFormRef.current.locationId,
        payload,
      });
      setLocations(model.locations);
      setLocationsState({ error: "", loading: false });
      if (Object.keys(model.patch).length) {
        callbacksRef.current.onFormPatch(model.patch, {
          reason: "locations-loaded",
          resetDraftBaseline: model.resetDraftBaseline,
        });
      }
      return model;
    } catch (error) {
      const message = error?.message || "Locations could not be loaded.";
      setLocations([]);
      setLocationsState({ error: message, loading: false });
      return null;
    }
  }, [activeWorkorder, request, workspace]);

  useEffect(() => {
    reloadLocations();
  }, [reloadLocations]);

  useEffect(() => {
    if (activeWorkorder || workspace !== "generator") return;
    const patch = createLocationTemplatePatch(currentForm, locations);
    if (Object.keys(patch).length) {
      callbacksRef.current.onFormPatch(patch, {
        reason: "template-reconciled",
        resetDraftBaseline: false,
      });
    }
  }, [activeWorkorder, currentForm, locations, workspace]);

  useEffect(() => {
    const locationId = selectedLocation?.location?.id || "";
    if (!canLoadCreateMechanics({ activeWorkorder, actorRole, selectedLocationId: locationId })) {
      setAssignment((current) => createAssignmentClearedState(current));
      return undefined;
    }

    setAssignment(createAssignmentLoadingState());
    setAssignment(createAssignmentLoadedState(selectedLocation?.mechanics));
    return undefined;
  }, [activeWorkorder, actorRole, selectedLocation]);

  const selectLocation = useCallback((locationId) => {
    const patch = createLocationSelectionPatch(locations, locationId);
    if (!patch) return null;

    callbacksRef.current.onClearLocationError("locationId");
    callbacksRef.current.onFormPatch(patch, {
      reason: "location-selected",
      resetDraftBaseline: false,
    });
    callbacksRef.current.onSelectionPatch(patch);
    return patch;
  }, [locations]);

  return {
    assignment,
    locations,
    locationsState,
    reloadLocations,
    selectLocation,
    selectedLocation,
    setAssignment,
  };
}
