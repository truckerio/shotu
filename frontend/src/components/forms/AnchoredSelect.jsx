import { useId } from "react";
import { Dropdown } from "./Dropdown.jsx";
import "./anchored-select.css";

export function AnchoredSelect({
  label,
  value,
  onChange,
  options,
  disabled = false,
  className = "",
  labelHidden = false,
}) {
  const generatedId = useId();
  const labelId = `anchored-select-${generatedId}`;

  return (
    <div className={`anchored-select ${labelHidden ? "is-label-hidden" : ""} ${className}`.trim()}>
      <span className="anchored-select-label" id={labelId}>{label}</span>
      <Dropdown aria-labelledby={labelId} disabled={disabled} value={value} onChange={(event) => onChange?.(event.target.value)}>
        {options.map((option) => <option disabled={option.disabled} key={option.value} value={option.value}>{option.label}</option>)}
      </Dropdown>
    </div>
  );
}
