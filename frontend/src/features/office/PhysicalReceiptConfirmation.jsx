import { useId, useState } from "react";
import { Package } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import "./physical-receipt-confirmation.css";

export function PhysicalReceiptConfirmation({ busy = false, disabled = false, onConfirm }) {
  const checkboxId = useId();
  const [attested, setAttested] = useState(false);
  const [mismatch, setMismatch] = useState(false);

  return (
    <section className="physical-receipt-confirmation" aria-labelledby={`${checkboxId}-title`}>
      <div className="physical-receipt-copy">
        <h3 id={`${checkboxId}-title`}>Confirm delivery</h3>
        <p>Check items are present and undamaged.</p>
      </div>
      <div className="physical-receipt-controls">
        <label htmlFor={checkboxId}>
          <input
            id={checkboxId}
            type="checkbox"
            checked={attested}
            onChange={(event) => { setAttested(event.target.checked); setMismatch(false); }}
            disabled={busy || disabled}
          />
          <span>All reviewed items received and undamaged</span>
        </label>
        <div className="physical-receipt-actions">
          <Button type="button" onClick={() => { setMismatch(true); setAttested(false); }} disabled={busy || disabled}>Missing or damaged</Button>
          <Button type="button" variant="primary" icon={Package} onClick={onConfirm} disabled={busy || disabled || !attested}>
            {busy ? "Adding inventory…" : "Add to inventory"}
          </Button>
        </div>
      </div>
      {mismatch ? <p className="physical-receipt-note" role="status">Inventory unchanged. Resolve the delivery issue, or correct the invoice if its values are wrong.</p> : null}
    </section>
  );
}
