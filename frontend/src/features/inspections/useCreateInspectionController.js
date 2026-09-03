import { useEffect, useMemo, useState } from "react";
import { weeklyInspectionTemplate } from "./inspection-model.js";

function unitMatches(unit, search) {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [unit.unitNo, unit.name, unit.vin, unit.plate, unit.unitType].filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(term));
}

export function resolvedLocationId({ locations = [], selectedUnit, locationId }) {
  if (locationId) return locationId;
  if (selectedUnit?.locationId) return selectedUnit.locationId;
  return locations.length === 1 ? locations[0].id : "";
}

export function useCreateInspectionController({ actor = {}, locations = [], mechanics = [], units = [], request, onCreated }) {
  const [unitSearch, setUnitSearch] = useState("");
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [locationId, setLocationId] = useState("");
  const [mechanicIds, setMechanicIds] = useState([]);
  const [dueDate, setDueDate] = useState("");
  const [instructions, setInstructions] = useState("");
  const [state, setState] = useState({ busy: false, error: "" });
  const [context, setContext] = useState({ locations, mechanics, units });
  const isMechanic = actor.role === "mechanic";
  const canAssign = actor.role === "office" || actor.role === "admin";
  const choices = useMemo(() => context.units.filter((unit) => unitMatches(unit, unitSearch)), [context.units, unitSearch]);
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

  async function submit(event) {
    event?.preventDefault?.();
    if (!selectedUnit?.id) { setState({ busy: false, error: "Select a unit before continuing." }); return null; }
    if (!effectiveLocationId) { setState({ busy: false, error: "Select an inspection location." }); return null; }
    const assigneeIds = isMechanic ? [actor.id].filter(Boolean) : mechanicIds;
    if (canAssign && !assigneeIds.length) { setState({ busy: false, error: "Assign at least one mechanic." }); return null; }
    if (typeof request !== "function") { setState({ busy: false, error: "Inspection creation is unavailable. Try again." }); return null; }
    setState({ busy: true, error: "" });
    try {
      const payload = {
        companyId: selectedUnit.companyId || selectedUnit.company_id,
        assetId: selectedUnit.id,
        locationId: effectiveLocationId,
        mechanicUserIds: assigneeIds,
        dueAt: dueDate ? `${dueDate}T23:59:59.999Z` : undefined,
        officeInstructions: instructions || undefined,
      };
      const result = await request?.("/api/inspections", { method: "POST", body: JSON.stringify(payload) });
      await onCreated?.(result);
      setState({ busy: false, error: "" });
      return result;
    } catch (error) {
      setState({ busy: false, error: error?.message || "The inspection could not be created." });
      return null;
    }
  }

  return { canAssign, choices, clearSelectedUnit, dueDate, effectiveLocationId, instructions, isMechanic, locationId, locations: context.locations, mechanicIds, mechanics: context.mechanics, selectedUnit, setDueDate, setInstructions, setLocationId, setMechanicIds, setUnitSearch, state, submit, template, unitSearch, selectUnit };
}
