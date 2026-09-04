import { Button } from "../../ui/Button.jsx";
import { normalizeLocale } from "../../../i18n/index.js";
import { isEligibleSerializedUnit } from "./workorder-serialized-part-selection.js";
import "./serialized-unit-child-picker.css";

const TEXT = {
  en: { available: "Available serial numbers", selected: "selected", selectAll: "Select all", clear: "Clear", stock: "In stock" },
  es: { available: "Números de serie disponibles", selected: "seleccionados", selectAll: "Seleccionar todos", clear: "Borrar", stock: "En existencia" },
  pa: { available: "ਉਪਲਬਧ ਸੀਰੀਅਲ ਨੰਬਰ", selected: "ਚੁਣੇ", selectAll: "ਸਾਰੇ ਚੁਣੋ", clear: "ਸਾਫ਼ ਕਰੋ", stock: "ਸਟਾਕ ਵਿੱਚ" },
};

function selectedSet(value) {
  return value instanceof Set ? value : new Set(Array.isArray(value) ? value : []);
}

export function SerializedUnitChildPicker({
  disabled = false,
  locale = "en",
  maxSelected = 18,
  onSelectionChange,
  partNumber = "",
  selectedUnitIds = [],
  units = [],
}) {
  const text = TEXT[normalizeLocale(locale)] || TEXT.en;
  const selected = selectedSet(selectedUnitIds);
  const eligibleUnits = units.filter(isEligibleSerializedUnit);

  function emit(next) {
    onSelectionChange?.(new Set(next));
  }

  function toggle(unitId) {
    const next = new Set(selected);
    if (next.has(unitId)) next.delete(unitId);
    else if (next.size < maxSelected) next.add(unitId);
    emit(next);
  }

  function selectAll() {
    emit(new Set(eligibleUnits.slice(0, maxSelected).map((unit) => unit.id)));
  }

  return (
    <fieldset className="serialized-unit-child-picker" disabled={disabled}>
      <legend>
        <span>{text.available}</span>
        <small role="status">{selected.size} {text.selected}</small>
      </legend>
      <div className="serialized-unit-child-actions">
        <Button type="button" onClick={selectAll} disabled={!eligibleUnits.length || selected.size === Math.min(eligibleUnits.length, maxSelected)}>{text.selectAll}</Button>
        {selected.size ? <Button type="button" onClick={() => emit(new Set())}>{text.clear}</Button> : null}
      </div>
      <div className="serialized-unit-child-list">
        {units.map((unit) => {
          const checked = selected.has(unit.id);
          const eligible = isEligibleSerializedUnit(unit);
          return (
            <label key={unit.id} className={checked ? "is-selected" : ""}>
              <input
                type="checkbox"
                value={unit.id}
                checked={checked}
                disabled={!eligible || (!checked && selected.size >= maxSelected)}
                onChange={() => toggle(unit.id)}
              />
              <span>
                <strong>{unit.serialNumber || unit.serial}</strong>
                <small>{unit.status === "in_stock" ? text.stock : unit.status}{unit.locationName ? ` · ${unit.locationName}` : ""}</small>
              </span>
              {partNumber ? <small className="serialized-unit-child-part">{partNumber}</small> : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
