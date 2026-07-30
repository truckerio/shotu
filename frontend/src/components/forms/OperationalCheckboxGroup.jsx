import { joinClassNames } from "./form-utils.js";
import "./operational-form.css";

export function OperationalCheckboxGroup({
  className = "",
  disabled = false,
  legend,
  onChange,
  options = [],
  selectedValues = [],
}) {
  const selected = new Set(selectedValues.map(String));

  function toggle(value, checked) {
    const normalized = String(value);
    const next = checked
      ? [...selectedValues.map(String).filter((entry) => entry !== normalized), normalized]
      : selectedValues.map(String).filter((entry) => entry !== normalized);
    onChange?.(next);
  }

  return (
    <fieldset className={joinClassNames("operational-checkbox-group", className)} disabled={disabled}>
      <legend>{legend}</legend>
      <div className="operational-checkbox-options">
        {options.map((option) => {
          const value = String(option.value);
          return (
            <label className="operational-checkbox-option" key={value}>
              <input
                type="checkbox"
                checked={selected.has(value)}
                onChange={(event) => toggle(value, event.target.checked)}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
