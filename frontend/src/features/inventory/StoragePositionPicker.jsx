import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { receiptStoragePositions, storagePositionPickerCopy } from "./storage-position-picker-model.js";

export function StoragePositionPicker({ positions = [], value = "", onChange, disabled = false, required = false, purpose = "receipt" }) {
  const options = receiptStoragePositions(positions, purpose);
  const copy = storagePositionPickerCopy(purpose);
  return <label className="add-inventory-storage-picker">
    <span>{copy.label}</span>
    <Dropdown value={value} onChange={(event) => onChange?.(event.target.value)} disabled={disabled} required={required} aria-label="Storage destination">
      <option value="">{copy.emptyLabel}</option>
      {options.map((position) => <option key={position.id} value={position.id}>{position.label}</option>)}
    </Dropdown>
    <small>{options.length ? copy.helper : copy.emptyHelper || "No eligible shelf or bin is configured for this shop."}</small>
  </label>;
}
