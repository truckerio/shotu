import { useEffect, useId, useRef, useState } from "react";
import "./section-help-disclosure.css";

export function SectionHelpDisclosure({ children, label }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const closeOnEscape = (event) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="section-help-disclosure" ref={rootRef} onKeyDown={closeOnEscape}>
      <button
        ref={triggerRef}
        className="section-help-disclosure-trigger"
        type="button"
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((current) => !current)}
      >?</button>
      <div className="section-help-disclosure-panel" id={panelId} role="note" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
