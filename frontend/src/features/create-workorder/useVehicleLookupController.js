import { useCallback, useEffect, useRef, useState } from "react";

import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { api } from "../../lib/api.js";
import {
  normalizeVehicleLookupValue,
  uniqueExactVehicleMatch,
  vehicleLookupValues,
} from "./create-workorder-utils.js";
import {
  vehicleBelongsToCompany,
  vehicleCompanyId,
  vehicleMileage,
  vehicleModelText,
  vehiclesForCompany,
} from "./vehicle-lookup-model.js";
import {
  activeWorkorderUnavailableMessage,
  vehicleCanBeSelected,
  vehicleHasActiveWorkorder,
} from "./vehicle-availability-model.js";
import { selectedVehicleFromWorkorderDraft } from "../generator/workorder-draft.js";

const EMPTY_LOOKUP = Object.freeze({ loading: false, status: "", results: [] });

export function vehicleLookupRequestIsCurrent(requestGeneration, currentGeneration, cancelled = false) {
  return !cancelled && requestGeneration === currentGeneration;
}

export function useVehicleLookupController({
  activeWorkorderId,
  clearCreateErrors,
  companyId = "",
  enabled,
  form,
  setForm,
  stageAutosave,
}) {
  const locationRequestRef = useRef({ vehicleId: "", promise: null });
  const locationBackoffUntilRef = useRef(0);
  const detailLocationRefreshRef = useRef("");
  const lookupGenerationRef = useRef(0);
  const formRef = useRef(form);
  const companyIdRef = useRef(companyId);
  const selectedVehicleRef = useRef(null);
  const [vehicleLookup, setVehicleLookup] = useState(EMPTY_LOOKUP);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [unitLookupQuery, setUnitLookupQuery] = useState(() => form.unitNo);
  formRef.current = form;
  companyIdRef.current = companyId;
  selectedVehicleRef.current = selectedVehicle;

  const refreshVehicleLocation = useCallback(async (vehicle = selectedVehicleRef.current) => {
    if (!vehicle?.id) return null;
    if (Date.now() < locationBackoffUntilRef.current) return null;
    const requestedVehicleId = vehicle.id;
    if (
      locationRequestRef.current.vehicleId === requestedVehicleId
      && locationRequestRef.current.promise
    ) return locationRequestRef.current.promise;

    const request = (async () => {
      try {
        const result = await api(`/api/vehicles/${encodeURIComponent(vehicle.id)}/live-location`, { method: "POST" });
        setSelectedVehicle((current) => current?.id === requestedVehicleId ? result.vehicle : current);
        return result.vehicle;
      } catch (error) {
        if (error.code === "INTEGRATION_AUTHENTICATION_REQUIRED") {
          locationBackoffUntilRef.current = Date.now() + 5 * 60_000;
        }
        setVehicleLookup((current) => ({ ...current, status: error.message }));
        return null;
      } finally {
        if (locationRequestRef.current.promise === request) {
          locationRequestRef.current = { vehicleId: "", promise: null };
        }
      }
    })();
    locationRequestRef.current = { vehicleId: requestedVehicleId, promise: request };
    return request;
  }, []);

  const applyVehicle = useCallback((vehicle) => {
    if (!vehicleBelongsToCompany(vehicle, companyIdRef.current)) {
      setVehicleLookup({
        loading: false,
        status: "Select a vehicle owned by the same company as the repair location.",
        results: [],
      });
      return false;
    }
    if (!vehicleCanBeSelected(vehicle, activeWorkorderId)) {
      setVehicleLookup({
        loading: false,
        status: activeWorkorderUnavailableMessage(vehicle),
        results: [vehicle],
      });
      return false;
    }
    const currentForm = formRef.current;
    const modelText = vehicleModelText(vehicle);
    clearCreateErrors("unitNo", ...(vehicle.owner_name ? ["customerCompanyName"] : []));
    const vehiclePatch = {
      customerCompanyName: vehicle.owner_name || currentForm.customerCompanyName,
      unitNo: vehicle.unit_no || vehicle.name || currentForm.unitNo,
      unitType: vehicle.unit_type || currentForm.unitType,
      licenseNo: vehicle.license_plate || currentForm.licenseNo,
      mileage: vehicleMileage(vehicle) || currentForm.mileage,
      model: modelText || currentForm.model,
      vinNo: vehicle.vin || currentForm.vinNo,
    };
    setForm((current) => ({ ...current, ...vehiclePatch }));
    stageAutosave(vehiclePatch);
    setUnitLookupQuery(vehiclePatch.unitNo);
    setVehicleLookup({
      loading: false,
      status: `${vehicle.unit_no || vehicle.name || "Vehicle"} applied from Samsara.`,
      results: [],
    });
    setSelectedVehicle(vehicle);
    refreshVehicleLocation(vehicle);
    return true;
  }, [activeWorkorderId, clearCreateErrors, refreshVehicleLocation, setForm, stageAutosave]);
  useEffect(() => {
    let cancelled = false;
    const requestGeneration = lookupGenerationRef.current;
    const query = unitLookupQuery.trim();
    if (query.length < 2) {
      setVehicleLookup((current) => ({ ...current, loading: false, results: [] }));
      return undefined;
    }
    if (selectedVehicle && vehicleLookupValues(selectedVehicle).includes(normalizeVehicleLookupValue(query))) {
      setVehicleLookup((current) => ({ ...current, loading: false, results: [] }));
      return undefined;
    }

    setVehicleLookup((current) => ({ ...current, loading: true, results: [] }));
    const timer = window.setTimeout(() => {
      api(`/api/vehicles/search?q=${encodeURIComponent(query)}&limit=6`, { timeoutMs: 10_000 })
        .then((result) => {
          if (!vehicleLookupRequestIsCurrent(requestGeneration, lookupGenerationRef.current, cancelled)) return;
          const vehicles = vehiclesForCompany(result.vehicles || [], companyIdRef.current);
          const exactMatch = uniqueExactVehicleMatch(vehicles, query);
          setVehicleLookup({
            loading: false,
            status: vehicleHasActiveWorkorder(exactMatch)
              ? activeWorkorderUnavailableMessage(exactMatch)
              : vehicles.length ? "Samsara vehicle data found." : "No vehicle match. Manual entry still works.",
            results: vehicles,
          });
        })
        .catch((error) => {
          if (vehicleLookupRequestIsCurrent(requestGeneration, lookupGenerationRef.current, cancelled)) {
            setVehicleLookup({ loading: false, status: error.message, results: [] });
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeWorkorderId, selectedVehicle, unitLookupQuery]);

  useEffect(() => {
    setUnitLookupQuery(form.unitNo);
  }, [form.unitNo]);

  useEffect(() => {
    if (
      !selectedVehicle
      || !vehicleCompanyId(selectedVehicle)
      || vehicleBelongsToCompany(selectedVehicle, companyId)
    ) return;
    setSelectedVehicle(null);
    setVehicleLookup({
      loading: false,
      status: "Vehicle cleared because the repair location belongs to a different company.",
      results: [],
    });
  }, [companyId, selectedVehicle]);

  useEffect(() => {
    if (!activeWorkorderId || !selectedVehicle?.id) {
      detailLocationRefreshRef.current = "";
      return;
    }
    const refreshKey = `${activeWorkorderId}:${selectedVehicle.id}`;
    if (detailLocationRefreshRef.current === refreshKey) return;
    detailLocationRefreshRef.current = refreshKey;
    refreshVehicleLocation(selectedVehicle);
  }, [activeWorkorderId, refreshVehicleLocation, selectedVehicle]);

  useAutomaticRefresh(
    () => refreshVehicleLocation(selectedVehicle),
    { enabled: Boolean(enabled && selectedVehicle?.id), intervalMs: 60_000 },
  );

  const updateUnitLookupQuery = useCallback((value) => {
    lookupGenerationRef.current += 1;
    setVehicleLookup((current) => ({ ...current, loading: false, results: [] }));
    setUnitLookupQuery(value);
    if (selectedVehicle && !vehicleLookupValues(selectedVehicle).includes(normalizeVehicleLookupValue(value))) {
      setSelectedVehicle(null);
    }
  }, [selectedVehicle]);

  const commitUnitNumber = useCallback((updateField) => {
    const value = unitLookupQuery;
    if (value !== formRef.current.unitNo) updateField("unitNo", value);
  }, [unitLookupQuery]);

  const restoreDraftVehicle = useCallback(async (payload) => {
    const snapshot = selectedVehicleFromWorkorderDraft(payload);
    setSelectedVehicle(snapshot);
    if (!snapshot?.id) return;
    try {
      const result = await api(`/api/vehicles/${encodeURIComponent(snapshot.id)}`);
      if (!vehicleBelongsToCompany(result.vehicle, companyIdRef.current)) {
        setSelectedVehicle(null);
        setVehicleLookup({
          loading: false,
          status: "The saved vehicle does not belong to the selected repair-location company.",
          results: [],
        });
        return;
      }
      if (!vehicleCanBeSelected(result.vehicle, activeWorkorderId)) {
        setSelectedVehicle(null);
        setVehicleLookup({ loading: false, status: activeWorkorderUnavailableMessage(result.vehicle), results: [result.vehicle] });
        return;
      }
      setSelectedVehicle((current) => current?.id === snapshot.id ? result.vehicle : current);
      refreshVehicleLocation(result.vehicle);
    } catch (error) {
      setVehicleLookup((current) => ({ ...current, status: error.message }));
    }
  }, [activeWorkorderId, refreshVehicleLocation]);

  const resetVehicleLookup = useCallback(() => {
    setSelectedVehicle(null);
    setVehicleLookup(EMPTY_LOOKUP);
  }, []);

  return {
    applyVehicle,
    refreshVehicleLocation,
    resetVehicleLookup,
    restoreDraftVehicle,
    selectedVehicle,
    setSelectedVehicle,
    unitLookupQuery,
    updateUnitLookupQuery,
    commitUnitNumber,
    vehicleLookup,
  };
}
