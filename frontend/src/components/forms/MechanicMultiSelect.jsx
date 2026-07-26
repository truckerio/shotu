import { SearchMd } from "@untitledui/icons";
import { useId } from "react";
import { joinClassNames } from "./form-utils.js";
import "./operational-form.css";

export function MechanicMultiSelect({
  className = "",
  description = "Select every mechanic assigned to this workorder.",
  disabled = false,
  emptyMessage = "No mechanics are available.",
  error = "",
  filterValue,
  legend = "Mechanics",
  mechanics = [],
  onChange,
  onFilterChange,
  selectedIds = [],
}) {
  const generatedId = useId().replaceAll(":", "");
  const errorId = error ? `mechanic-selection-error-${generatedId}` : undefined;
  const selected = new Set(selectedIds.map(String));

  function toggleMechanic(mechanicId, checked) {
    const id = String(mechanicId);
    const next = checked
      ? [...selectedIds.map(String).filter((selectedId) => selectedId !== id), id]
      : selectedIds.map(String).filter((selectedId) => selectedId !== id);
    onChange?.(next);
  }

  return (
    <fieldset
      className={joinClassNames("operational-mechanic-select", error && "has-error", className)}
      disabled={disabled}
      aria-describedby={errorId}
    >
      <legend>{legend}</legend>
      {description ? <p>{description}</p> : null}
      {onFilterChange ? (
        <label className="operational-mechanic-filter">
          <span className="operational-sr-only">Search mechanics</span>
          <SearchMd aria-hidden="true" />
          <input
            type="search"
            value={filterValue || ""}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder="Search mechanics"
          />
        </label>
      ) : null}
      <div className="operational-mechanic-options">
        {mechanics.length ? mechanics.map((mechanic) => {
          const id = String(mechanic.id);
          return (
            <label className="operational-mechanic-option" key={id}>
              <input
                type="checkbox"
                checked={selected.has(id)}
                disabled={disabled || mechanic.disabled}
                onChange={(event) => toggleMechanic(id, event.target.checked)}
              />
              <span>
                <strong>{mechanic.name}</strong>
                {mechanic.secondary ? <small>{mechanic.secondary}</small> : null}
              </span>
            </label>
          );
        }) : <p className="operational-mechanic-empty">{emptyMessage}</p>}
      </div>
      {error ? <span className="operational-form-field-error" id={errorId}>{error}</span> : null}
    </fieldset>
  );
}
