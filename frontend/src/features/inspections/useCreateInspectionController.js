import { useEffect, useMemo, useRef, useState } from "react";
import { weeklyInspectionTemplate } from "./inspection-model.js";

function unitMatches(unit, search) {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [unit.unitNo, unit.name, unit.vin, unit.plate, unit.unitType].filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(term));
}

function normalizedUnitIdentity(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function canCreateInspectionLocalUnit(actor = {}) {
  return ["office", "admin"].includes(actor.role);
}

export function hasExactInspectionUnit(units = [], search = "") {
  const identity = normalizedUnitIdentity(search);
  if (!identity) return false;
  return units.some((unit) => [unit.unitNo, unit.vin, unit.plate]
    .filter(Boolean)
    .some((value) => normalizedUnitIdentity(value) === identity));
}

export function localInspectionUnitPayload({ localUnit, location }) {
  return {
    companyId: location?.companyId || "",
    locationId: location?.id || "",
    unitType: localUnit.unitType,
    unitNo: localUnit.unitNo.trim(),
    vin: localUnit.vin.trim(),
    licensePlate: localUnit.plate.trim(),
    confirmDuplicate: Boolean(localUnit.confirmDuplicate),
  };
}

export function resolvedLocationId({ locations = [], selectedUnit, locationId }) {
  if (locationId) return locationId;
  if (selectedUnit?.locationId) return selectedUnit.locationId;
  return locations.length === 1 ? locations[0].id : "";
}

export function inspectionCreateIdempotencyKey() {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `inspection-create-${suffix}`;
}

export function inspectionCreateAttempt(currentAttempt, payload, createKey = inspectionCreateIdempotencyKey) {
  const fingerprint = JSON.stringify(payload);
  if (currentAttempt?.fingerprint === fingerprint && currentAttempt.idempotencyKey) return currentAttempt;
  return { fingerprint, idempotencyKey: createKey() };
}

export function useCreateInspectionController({ actor = {}, locations = [], mechanics = [], units = [], request, onCreated }) {
  const [unitSearch, setUnitSearch] = useState("");
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [locationId, setLocationId] = useState("");
  const [mechanicIds, setMechanicIds] = useState([]);
  const [dueDate, setDueDate] = useState("");
  const [instructions, setInstructions] = useState("");
  const [localUnitOpen, setLocalUnitOpen] = useState(false);
  const [localUnit, setLocalUnit] = useState({ unitNo: "", unitType: "", vin: "", plate: "", confirmDuplicate: false });
  const [state, setState] = useState({ busy: false, error: "" });
  const [context, setContext] = useState({ locations, mechanics, units });
  const createAttempt = useRef(null);
  const isMechanic = actor.role === "mechanic";
  const canAssign = actor.role === "office" || actor.role === "admin";
  const canCreateLocalUnit = canCreateInspectionLocalUnit(actor);
  const choices = useMemo(() => context.units.filter((unit) => unitMatches(unit, unitSearch)), [context.units, unitSearch]);
  const hasExactUnit = hasExactInspectionUnit(context.units, unitSearch);
  const template = selectedUnit ? weeklyInspectionTemplate(selectedUnit.unitType) : null;
  const effectiveLocationId = resolvedLocationId({ locations: context.locations, selectedUnit, locationId });

  useEffect(() => {
    if (typeof request !== "function") return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (unitSearch.trim().length >= 2) params.set("search", unitSearch.trim());
      if (effectiveLocationId) params.set("locationId", effectiveLocationId);
      request(`/api/inspections/create-context?${params}`, { signal: controller.signal })
        .then((result) => setContext({ locations: result.locations || [], mechanics: result.mechanics || [], units: result.units || [] }))
        .catch((error) => { if (error?.name !== "AbortError") setState((current) => ({ ...current, error: error?.message || "Inspection choices could not be loaded." })); });
    }, unitSearch.trim().length >= 2 ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [effectiveLocationId, request, unitSearch]);

  function selectUnit(unit) {
    setSelectedUnit(unit); setUnitSearch(unit.unitNo || unit.name || ""); setState({ busy: false, error: "" });
    if (unit.locationId) setLocationId(unit.locationId);
  }

  function clearSelectedUnit() {
    setSelectedUnit(null);
    setUnitSearch("");
    setState({ busy: false, error: "" });
  }

  function openLocalUnit() {
    setLocalUnit((current) => ({ ...current, unitNo: current.unitNo || unitSearch.trim(), confirmDuplicate: false }));
    setLocalUnitOpen(true);
  }

  function setLocalUnitField(field, value) {
    setLocalUnit((current) => ({ ...current, [field]: value, ...(field === "unitNo" || field === "vin" || field === "plate" ? { confirmDuplicate: false } : {}) }));
  }

  async function createLocalUnit() {
    const location = context.locations.find((entry) => entry.id === effectiveLocationId) || null;
    if (!location) { setState({ busy: false, error: "Select an inspection location before adding a local unit." }); return null; }
    if (!localUnit.unitNo.trim() || !localUnit.unitType) { setState({ busy: false, error: "Enter a unit number and choose Truck or Trailer." }); return null; }
    if (typeof request !== "function") { setState({ busy: false, error: "Local unit creation is unavailable. Try again." }); return null; }
    setState({ busy: true, error: "" });
    try {
      const result = await request("/api/vehicles/manual", { method: "POST", body: JSON.stringify(localInspectionUnitPayload({ localUnit, location })) });
      const vehicle = result.vehicle;
      if (!vehicle?.id) throw new Error("Local unit could not be created.");
      selectUnit({ id: vehicle.id, companyId: vehicle.company_id || vehicle.companyId, locationId: vehicle.location_id || vehicle.locationId, unitNo: vehicle.unit_no || vehicle.unitNo, name: vehicle.name, unitType: vehicle.unit_type || vehicle.unitType, vin: vehicle.vin, plate: vehicle.license_plate || vehicle.licensePlate });
      setLocalUnitOpen(false);
      setLocalUnit({ unitNo: "", unitType: "", vin: "", plate: "", confirmDuplicate: false });
      return vehicle;
    } catch (error) {
      if (error?.code === "MANUAL_VEHICLE_DUPLICATE_CONFIRMATION_REQUIRED") {
        setLocalUnit((current) => ({ ...current, confirmDuplicate: true }));
      }
      setState({ busy: false, error: error?.message || "The local unit could not be created." });
      return null;
    }
  }

  async function submit(event) {
    event?.preventDefault?.();
    if (!selectedUnit?.id) { setState({ busy: false, error: "Select a unit before continuing." }); return null; }
    if (!effectiveLocationId) { setState({ busy: false, error: "Select an inspection location." }); return null; }
    const assigneeIds = isMechanic ? [actor.id].filter(Boolean) : mechanicIds;
    if (canAssign && !assigneeIds.length) { setState({ busy: false, error: "Assign at least one mechanic." }); return null; }
    if (typeof request !== "function") { setState({ busy: false, error: "Inspection creation is unavailable. Try again." }); return null; }
    setState({ busy: true, error: "" });
    let attempt;
    try {
      const payload = {
        companyId: selectedUnit.companyId || selectedUnit.company_id,
        assetId: selectedUnit.id,
        locationId: effectiveLocationId,
        mechanicUserIds: assigneeIds,
        dueAt: dueDate ? `${dueDate}T23:59:59.999Z` : undefined,
        officeInstructions: instructions || undefined,
      };
      attempt = inspectionCreateAttempt(createAttempt.current, payload);
      createAttempt.current = attempt;
      const result = await request?.("/api/inspections", { method: "POST", body: JSON.stringify({ ...payload, idempotencyKey: attempt.idempotencyKey }) });
      await onCreated?.(result);
      createAttempt.current = null;
      setState({ busy: false, error: "" });
      return result;
    } catch (error) {
      createAttempt.current = attempt;
      setState({ busy: false, error: error?.message || "The inspection could not be created." });
      return null;
    }
  }

  return { canAssign, canCreateLocalUnit, choices, clearSelectedUnit, createLocalUnit, dueDate, effectiveLocationId, hasExactUnit, instructions, isMechanic, localUnit, localUnitOpen, locationId, locations: context.locations, mechanicIds, mechanics: context.mechanics, openLocalUnit, selectedUnit, setDueDate, setInstructions, setLocalUnitField, setLocationId, setMechanicIds, setLocalUnitOpen, setUnitSearch, state, submit, template, unitSearch, selectUnit };
}
