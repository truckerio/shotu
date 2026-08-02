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
  createLocationMechanicsEndpoint,
  createLocationSelectionPatch,
  createTemplateEndpoint,
} from "./create-location-controller-model.js";

const EMPTY_CALLBACK = () => {};

export function useCreateLocationController({
  activeWorkorder = null,
  actorRole = "",
  currentForm = {},
  request = api,
  templateApiRole = "",
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
    loading: Boolean(templateApiRole),
  });
  const [assignment, setAssignment] = useState(EMPTY_CREATE_ASSIGNMENT);

  const selectedLocation = useMemo(
    () => resolveCreateLocation(locations, currentForm.locationId),
    [currentForm.locationId, locations],
  );

  const reloadLocations = useCallback(async () => {
    const endpoint = createTemplateEndpoint(templateApiRole);
    if (!endpoint) {
      setLocations([]);
      setLocationsState({ error: "", loading: false });
      return null;
    }

    setLocationsState({ error: "", loading: true });
    try {
      const payload = await request(endpoint);
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
  }, [request, templateApiRole]);

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

    let cancelled = false;
    setAssignment((current) => createAssignmentLoadingState(current));
    request(createLocationMechanicsEndpoint(locationId))
      .then(({ mechanics }) => {
        if (!cancelled) setAssignment(createAssignmentLoadedState(mechanics));
      })
      .catch((error) => {
        if (!cancelled) {
          setAssignment(createAssignmentClearedState(
            EMPTY_CREATE_ASSIGNMENT,
            error?.message || "Mechanics could not be loaded.",
          ));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkorder, actorRole, request, selectedLocation?.location?.id]);

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
