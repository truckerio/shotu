import { useCallback, useEffect, useRef, useState } from "react";

import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { api } from "../../lib/api.js";
import {
  normalizeVehicleLookupValue,
  uniqueExactVehicleMatch,
  vehicleLookupValues,
} from "./create-workorder-utils.js";
import { vehicleMileage, vehicleModelText } from "./vehicle-lookup-model.js";
import { selectedVehicleFromWorkorderDraft } from "../generator/workorder-draft.js";

const EMPTY_LOOKUP = Object.freeze({ loading: false, status: "", results: [] });

export function useVehicleLookupController({
  activeWorkorderId,
  clearCreateErrors,
  enabled,
  form,
  setForm,
  stageAutosave,
}) {
  const locationRequestRef = useRef({ vehicleId: "", promise: null });
  const detailLocationRefreshRef = useRef("");
  const [vehicleLookup, setVehicleLookup] = useState(EMPTY_LOOKUP);
  const [selectedVehicle, setSelectedVehicle] = useState(null);

  const refreshVehicleLocation = useCallback(async (vehicle = selectedVehicle) => {
    if (!vehicle?.id) return null;
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
  }, [selectedVehicle]);

  const applyVehicle = useCallback((vehicle) => {
    const modelText = vehicleModelText(vehicle);
    clearCreateErrors("unitNo", ...(vehicle.owner_name ? ["customerCompanyName"] : []));
    const vehiclePatch = {
      customerCompanyName: vehicle.owner_name || form.customerCompanyName,
      unitNo: vehicle.unit_no || vehicle.name || form.unitNo,
      unitType: vehicle.unit_type || form.unitType,
      licenseNo: vehicle.license_plate || form.licenseNo,
      mileage: vehicleMileage(vehicle) || form.mileage,
      model: modelText || form.model,
      vinNo: vehicle.vin || form.vinNo,
    };
    setForm((current) => ({ ...current, ...vehiclePatch }));
    stageAutosave(vehiclePatch);
    setVehicleLookup({
      loading: false,
      status: `${vehicle.unit_no || vehicle.name || "Vehicle"} applied from Samsara.`,
      results: [],
    });
    setSelectedVehicle(vehicle);
    refreshVehicleLocation(vehicle);
  }, [clearCreateErrors, form, refreshVehicleLocation, setForm, stageAutosave]);

  useEffect(() => {
    let cancelled = false;
    const query = form.unitNo.trim();
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
      api(`/api/vehicles/search?q=${encodeURIComponent(query)}&limit=8`)
        .then((result) => {
          if (cancelled) return;
          const vehicles = result.vehicles || [];
          const exactMatch = uniqueExactVehicleMatch(vehicles, query);
          if (exactMatch) {
            applyVehicle(exactMatch);
            return;
          }
          setVehicleLookup({
            loading: false,
            status: vehicles.length ? "Samsara vehicle data found." : "No vehicle match. Manual entry still works.",
            results: vehicles,
          });
        })
        .catch((error) => {
          if (!cancelled) setVehicleLookup({ loading: false, status: error.message, results: [] });
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [applyVehicle, form.unitNo, selectedVehicle]);

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

  const updateUnitNumber = useCallback((value, updateField) => {
    updateField("unitNo", value);
    if (selectedVehicle && !vehicleLookupValues(selectedVehicle).includes(normalizeVehicleLookupValue(value))) {
      setSelectedVehicle(null);
    }
  }, [selectedVehicle]);

  const restoreDraftVehicle = useCallback(async (payload) => {
    const snapshot = selectedVehicleFromWorkorderDraft(payload);
    setSelectedVehicle(snapshot);
    if (!snapshot?.id) return;
    try {
      const result = await api(`/api/vehicles/${encodeURIComponent(snapshot.id)}`);
      setSelectedVehicle((current) => current?.id === snapshot.id ? result.vehicle : current);
      refreshVehicleLocation(result.vehicle);
    } catch (error) {
      setVehicleLookup((current) => ({ ...current, status: error.message }));
    }
  }, [refreshVehicleLocation]);

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
    updateUnitNumber,
    vehicleLookup,
  };
}
