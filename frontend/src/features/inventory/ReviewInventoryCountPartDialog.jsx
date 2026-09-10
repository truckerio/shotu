import { useId, useState } from "react";
import { XClose } from "@untitledui/icons";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { UnitOfMeasurePicker } from "../../components/forms/UnitOfMeasurePicker.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";
import "./create-inventory-part-dialog.css";

export function ReviewInventoryCountPartDialog({ part, quantity, onClose, onSaved }) {
  const titleId = useId();
  const descriptionId = useId();
  const [uomCode, setUomCode] = useState(part.uomCode || "ea");
  const [trackingMode, setTrackingMode] = useState(part.trackingMode || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (!trackingMode) {
      setError("Choose how this part is tracked.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api(`/api/office/inventory/parts/${encodeURIComponent(part.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: part.version,
          description: part.description,
          partNumber: part.partNumber,
          manufacturer: part.manufacturer,
          category: part.category,
          barcode: part.barcode,
          uomCode,
          trackingMode,
          referenceNumbers: part.referenceNumbers || [],
        }),
      });
      await onSaved?.({ ...result.part, id: result.part?.catalogPartId || part.id });
    } catch (nextError) {
      setError(nextError.message || "Part tracking could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <ModalOverlay className="create-inventory-part-overlay" isOpen isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) onClose?.(); }}>
    <Modal className="create-inventory-part-modal">
      <Dialog className="create-inventory-part-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <form onSubmit={submit} noValidate>
          <header>
            <div><Heading slot="title" id={titleId}>Review master part</Heading><p id={descriptionId}>Choose the local unit and tracking before adding this counted stock.</p></div>
            <button type="button" aria-label="Close part review" onClick={onClose} disabled={busy}><XClose aria-hidden="true" /></button>
          </header>
          {error ? <p className="create-inventory-part-error" role="alert" aria-live="assertive">{error}</p> : null}
          <div className="create-inventory-part-fields">
            <div><strong>{part.partNumber}</strong><br /><span>{part.description || "No part name"}</span></div>
            <div className="create-inventory-part-unit"><span>Unit for the counted quantity</span><UnitOfMeasurePicker uomCode={uomCode} onChange={(value) => { setUomCode(value); setError(""); }} disabled={busy} /><small>The count will add {quantity} {uomCode} at this location.</small></div>
            <label><span>How do you track this part?</span><Dropdown autoFocus value={trackingMode} onChange={(event) => { setTrackingMode(event.target.value); setError(""); }} disabled={busy} required><option value="">Choose tracking</option><option value="quantity">Quantity — small interchangeable parts</option><option value="serialized">Serialized — one identity per physical unit</option><option value="measured_bulk">Measured or bulk — fluids and divisible material</option></Dropdown><small>This applies to this master part at every location.</small></label>
          </div>
          <footer><Button type="button" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save and match"}</Button></footer>
        </form>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
