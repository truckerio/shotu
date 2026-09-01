import { ChevronDown } from "@untitledui/icons";
import { useEffect, useId, useRef, useState } from "react";
import { FormField } from "./FormField.jsx";
import { textEntryProps } from "./text-entry-policy.js";
import "./operational-form.css";

export function CustomerCompanyField({
  error = "",
  hint = "Company that owns or operates this unit.",
  id = "customer-company-name",
  label = "Customer company",
  onChange,
  required = false,
  requiredLabel = "Required",
  suggestions = [],
  suggestionsLabel = "Companies associated with this unit",
  value,
  ...inputProps
}) {
  const options = suggestions.map((name, index) => ({ id: `customer-company-${index}`, name }));
  const listboxId = `customer-company-options-${useId().replaceAll(":", "")}`;
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestionKey = suggestions.join("\u0000");

  useEffect(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, [suggestionKey]);

  useEffect(() => {
    function closeFromOutside(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, []);

  function select(option) {
    onChange?.(option.name);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!options.length || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    if (event.key === "Enter") {
      if (open && activeIndex >= 0) {
        event.preventDefault();
        select(options[activeIndex]);
      }
      return;
    }
    event.preventDefault();
    setOpen(true);
    setActiveIndex((current) => {
      if (event.key === "ArrowDown") return current >= options.length - 1 ? 0 : current + 1;
      return current <= 0 ? options.length - 1 : current - 1;
    });
  }

  return (
    <FormField id={id} label={label} hint={hint} error={error} required={required} requiredLabel={requiredLabel}>
      {(accessibility) => options.length ? (
        <div className="customer-company-combobox" ref={rootRef}>
          <div className="customer-company-combobox-control">
            <input
              {...textEntryProps("name")}
              {...inputProps}
              id={accessibility.id}
              aria-describedby={accessibility.describedBy}
              aria-invalid={accessibility.invalid || undefined}
              aria-required={accessibility.required || undefined}
              aria-autocomplete="list"
              aria-controls={open ? listboxId : undefined}
              aria-expanded={open}
              aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
              required={accessibility.required || undefined}
              autoComplete="organization"
              className="customer-company-combobox-input"
              role="combobox"
              type="text"
              value={value}
              onChange={(event) => onChange?.(event.target.value, event)}
              onKeyDown={handleKeyDown}
            />
            <button
              className="customer-company-combobox-trigger"
              aria-label={suggestionsLabel}
              aria-expanded={open}
              aria-controls={listboxId}
              type="button"
              onClick={() => {
                setOpen((current) => !current);
                setActiveIndex((current) => current >= 0 ? current : 0);
              }}
            >
              <ChevronDown aria-hidden="true" />
            </button>
          </div>
          {open ? (
            <div className="customer-company-combobox-popover">
              <div className="customer-company-combobox-listbox" id={listboxId} role="listbox" aria-label={suggestionsLabel}>
                {options.map((option, index) => (
                  <button
                    className="customer-company-combobox-option"
                    id={`${listboxId}-option-${index}`}
                    key={option.id}
                    role="option"
                    aria-selected={activeIndex === index}
                    tabIndex={-1}
                    type="button"
                    onClick={() => select(option)}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <span>{option.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <input
          {...textEntryProps("name")}
          {...inputProps}
          id={accessibility.id}
          aria-describedby={accessibility.describedBy}
          aria-invalid={accessibility.invalid || undefined}
          aria-required={accessibility.required || undefined}
          required={accessibility.required || undefined}
          type="text"
          value={value}
          onChange={(event) => onChange?.(event.target.value, event)}
          autoComplete="organization"
        />
      )}
    </FormField>
  );
}
