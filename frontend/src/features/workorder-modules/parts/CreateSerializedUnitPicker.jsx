import { useEffect, useRef, useState } from "react";
import { SerializedUnitNestedDropdown } from "../../../components/workorders/part-requests/SerializedUnitNestedDropdown.jsx";
import { normalizeLocale } from "../../../i18n/index.js";
import { api } from "../../../lib/api.js";
import { serializedSelectionPatch } from "./create-parts-model.js";

const TEXT = {
  en: { empty: "No serialized units are available at this location.", error: "Serialized units could not be loaded." },
  es: { empty: "No hay unidades serializadas disponibles en esta ubicación.", error: "No se pudieron cargar las unidades serializadas." },
  pa: { empty: "ਇਸ ਟਿਕਾਣੇ ਤੇ ਕੋਈ ਸੀਰੀਅਲ ਯੂਨਿਟ ਉਪਲਬਧ ਨਹੀਂ ਹੈ।", error: "ਸੀਰੀਅਲ ਯੂਨਿਟ ਲੋਡ ਨਹੀਂ ਹੋ ਸਕੇ।" },
};

export function CreateSerializedUnitPicker({
  locationId,
  locale = "en",
  onClose,
  onSelectionChange,
  open,
  part = {},
}) {
  const text = TEXT[normalizeLocale(locale)] || TEXT.en;
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const selectedIdsRef = useRef(new Set(part.serializedUnitIds || []));
  const endpoint = locationId && part.catalogPartId
    ? `/api/workorders/create-inventory/locations/${encodeURIComponent(locationId)}/parts/${encodeURIComponent(part.catalogPartId)}/units?limit=100`
    : "";

  useEffect(() => {
    if (!open || !endpoint) return undefined;
    let active = true;
    setLoading(true);
    setMessage("");
    api(endpoint).then((result) => {
      if (!active) return;
      const nextUnits = Array.isArray(result?.units) ? result.units : [];
      const availableIds = new Set(nextUnits.map((unit) => unit.id));
      const retainedIds = (part.serializedUnitIds || []).filter((id) => availableIds.has(id));
      const selection = serializedSelectionPatch(nextUnits, retainedIds);
      selectedIdsRef.current = new Set(retainedIds);
      setUnits(nextUnits);
      if (retainedIds.length !== (part.serializedUnitIds || []).length || String(part.qty || "") !== selection.qty) {
        onSelectionChange?.(selection);
      }
    }).catch((error) => {
      if (!active) return;
      setUnits([]);
      setMessage(error?.message || text.error);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [endpoint, open]);

  function updateSelection(nextIds) {
    selectedIdsRef.current = new Set(nextIds);
    onSelectionChange?.(serializedSelectionPatch(units, nextIds));
  }

  function commitSelection() {
    onSelectionChange?.(serializedSelectionPatch(units, selectedIdsRef.current));
    onClose?.();
  }

  if (!open) return null;
  return (
    <SerializedUnitNestedDropdown
      autoFocusSearch={false}
      error={message}
      loading={loading}
      locale={locale}
      maxSelected={18}
      emptyMessage={text.empty}
      onClose={onClose}
      onConfirm={commitSelection}
      onSelectionChange={updateSelection}
      partNumber={part.partNo}
      selectedUnitIds={part.serializedUnitIds || []}
      showConfirmCount={false}
      units={units}
    />
  );
}
