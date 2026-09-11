import { useEffect, useRef, useState } from "react";
import { SerializedUnitNestedDropdown } from "../../../components/workorders/part-requests/SerializedUnitNestedDropdown.jsx";
import { normalizeLocale } from "../../../i18n/index.js";
import { api } from "../../../lib/api.js";
import { serializedSelectionPatch } from "./create-parts-model.js";
import { Button } from "../../../components/ui/Button.jsx";
import { WorkorderSerializedPartDialog } from "../../../components/workorders/part-requests/WorkorderSerializedPartDialog.jsx";

const TEXT = {
  en: { empty: "No serialized units are available at this location.", error: "Serialized units could not be loaded." },
  es: { empty: "No hay unidades serializadas disponibles en esta ubicación.", error: "No se pudieron cargar las unidades serializadas." },
  pa: { empty: "ਇਸ ਟਿਕਾਣੇ ਤੇ ਕੋਈ ਸੀਰੀਅਲ ਯੂਨਿਟ ਉਪਲਬਧ ਨਹੀਂ ਹੈ।", error: "ਸੀਰੀਅਲ ਯੂਨਿਟ ਲੋਡ ਨਹੀਂ ਹੋ ਸਕੇ।" },
};

export function CreateSerializedUnitPicker({
  excludedUnitIds = [],
  locationId,
  locale = "en",
  maxSelected = 18,
  onClose,
  onSelectionChange,
  open,
  part = {},
}) {
  const text = TEXT[normalizeLocale(locale)] || TEXT.en;
  const [units, setUnits] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set(Array.isArray(part.serializedUnitIds) ? part.serializedUnitIds : []));
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intakeAllowed, setIntakeAllowed] = useState(false);
  const [locationName, setLocationName] = useState("");
  const [revision, setRevision] = useState(0);
  const [batch, setBatch] = useState(null);
  const selectedIdsRef = useRef(new Set(Array.isArray(part.serializedUnitIds) ? part.serializedUnitIds : []));
  const endpoint = locationId && part.catalogPartId
    ? `/api/workorders/create-inventory/locations/${encodeURIComponent(locationId)}/parts/${encodeURIComponent(part.catalogPartId)}/units?limit=100`
    : "";
  const partSelectedUnitIds = Array.isArray(part.serializedUnitIds) ? part.serializedUnitIds : [];
  const excludedIds = excludedUnitIds instanceof Set
    ? excludedUnitIds
    : new Set(Array.isArray(excludedUnitIds) ? excludedUnitIds : []);
  const selectedUnitKey = partSelectedUnitIds.join("|");
  const excludedUnitKey = [...excludedIds].sort().join("|");

  useEffect(() => {
    if (!open || !endpoint) return undefined;
    let active = true;
    const initialSelected = new Set(partSelectedUnitIds);
    selectedIdsRef.current = initialSelected;
    setSelectedIds(initialSelected);
    setUnits([]);
    setLoading(true);
    setMessage("");
    api(endpoint).then((result) => {
      if (!active) return;
      const currentIds = new Set(partSelectedUnitIds);
      const nextUnits = (Array.isArray(result?.units) ? result.units : [])
        .filter((unit) => !excludedIds.has(unit.id) || currentIds.has(unit.id));
      const availableIds = new Set(nextUnits.map((unit) => unit.id));
      const retainedIds = partSelectedUnitIds.filter((id) => availableIds.has(id));
      selectedIdsRef.current = new Set(retainedIds);
      setSelectedIds(new Set(retainedIds));
      setUnits(nextUnits);
    }).catch((error) => {
      if (!active) return;
      setUnits([]);
      setMessage(error?.message || text.error);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [endpoint, excludedUnitKey, open, selectedUnitKey, revision]);

  useEffect(() => {
    setIntakeOpen(false);
    setIntakeAllowed(false);
    setBatch(null);
    if (!open || !locationId || !part.catalogPartId) return undefined;
    let active = true;
    api(`/api/office/inventory/parts/${encodeURIComponent(part.catalogPartId)}/locations/${encodeURIComponent(locationId)}/units`)
      .then((result) => {
        if (!active) return;
        setIntakeAllowed(result.canCreateAtLocation === true && result.canCreateSerializedUnits === true);
        setLocationName(result.location?.name || result.location?.locationName || "");
      }).catch(() => { if (active) setIntakeAllowed(false); });
    return () => { active = false; };
  }, [open, locationId, part.catalogPartId]);

  function updateSelection(nextIds) {
    selectedIdsRef.current = new Set(nextIds);
    setSelectedIds(new Set(nextIds));
  }

  function commitSelection() {
    onSelectionChange?.(serializedSelectionPatch(units, selectedIdsRef.current));
    onClose?.();
  }

  if (!open) return null;
  if (intakeOpen) return <WorkorderSerializedPartDialog
    open
    createOnly
    locationId={locationId}
    catalogPart={{ id: part.catalogPartId, partNumber: part.partNo, uomCode: part.uomCode, locationName }}
    locale={locale}
    onClose={() => setIntakeOpen(false)}
    onCreated={(result) => {
      setBatch(result.batch || result.labelBatch || null);
      setIntakeOpen(false);
      setRevision((value) => value + 1);
    }}
  />;
  const addUnits = intakeAllowed ? <Button type="button" onClick={() => setIntakeOpen(true)}>{normalizeLocale(locale) === "es" ? "Agregar unidades" : normalizeLocale(locale) === "pa" ? "ਯੂਨਿਟ ਜੋੜੋ" : "Add units"}</Button> : null;
  return (
    <SerializedUnitNestedDropdown
      anchorToPartField
      autoFocusSearch={false}
      error={message}
      loading={loading}
      locale={locale}
      maxSelected={maxSelected}
      emptyMessage={text.empty}
      emptyAction={addUnits}
      footerAction={units.length ? addUnits : null}
      topContent={batch?.printUrl ? <a href={batch.printUrl} target="_blank" rel="noreferrer">Print QR labels</a> : null}
      onClose={onClose}
      onConfirm={commitSelection}
      onSelectionChange={updateSelection}
      partNumber={part.partNo}
      selectedUnitIds={selectedIds}
      showConfirmCount={false}
      units={units}
    />
  );
}
