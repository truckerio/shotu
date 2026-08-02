import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "@untitledui/icons";
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
  const listboxId = `anchored-select-${generatedId}`;
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options[selectedIndex] || options[0];

  useEffect(() => {
    if (!open) return undefined;
    function closeOnOutsidePointer(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function openAt(index) {
    setOpen(true);
    window.requestAnimationFrame(() => optionRefs.current[index]?.focus());
  }

  function select(option) {
    onChange?.(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleTriggerKeyDown(event) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    openAt(event.key === "ArrowUp" ? Math.max(0, options.length - 1) : selectedIndex);
  }

  function handleOptionKeyDown(event, index) {
    const lastIndex = options.length - 1;
    let nextIndex = null;
    if (event.key === "ArrowDown") nextIndex = Math.min(lastIndex, index + 1);
    if (event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = lastIndex;
    if (nextIndex === null) return;
    event.preventDefault();
    optionRefs.current[nextIndex]?.focus();
  }

  return (
    <div className={`anchored-select ${labelHidden ? "is-label-hidden" : ""} ${className}`.trim()} ref={rootRef}>
      <span className="anchored-select-label" id={`${listboxId}-label`}>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="anchored-select-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-labelledby={`${listboxId}-label`}
        disabled={disabled}
        onClick={() => open ? setOpen(false) : openAt(selectedIndex)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{selectedOption?.label || "Select"}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div className="anchored-select-popover">
          <div className="anchored-select-options" id={listboxId} role="listbox" aria-labelledby={`${listboxId}-label`}>
            {options.map((option, index) => (
              <button
                ref={(node) => { optionRefs.current[index] = node; }}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`anchored-select-option ${option.value === value ? "is-selected" : ""}`.trim()}
                onClick={() => select(option)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                key={option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
