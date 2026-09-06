import { useId, useState } from "react";
import { XClose } from "@untitledui/icons";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { UnitOfMeasurePicker } from "../../components/forms/UnitOfMeasurePicker.jsx";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";
import { getUnitDefinition, normalizeUomCode } from "../../../../shared/units-of-measure.js";
import "./create-inventory-part-dialog.css";

function initialDraft(defaults) {
  const proposedUnit = normalizeUomCode(defaults.uomCode || "ea");
  return {
    partNumber: String(defaults.partNumber || "").trim(),
    description: String(defaults.description || "").trim(),
    uomCode: getUnitDefinition(proposedUnit) ? proposedUnit : "ea",
    trackingMode: "",
    manufacturer: "",
    category: "",
    referenceNumber: "",
  };
}

export function CreateInventoryPartDialog({ locationId = "", locations = [], defaults = {}, onClose, onCreated }) {
  const titleId = useId();
  const descriptionId = useId();
  const partNumberId = useId();
  const partNameId = useId();
  const manufacturerId = useId();
  const categoryId = useId();
  const referenceId = useId();
  const locationInputId = useId();
  const [selectedLocationId, setSelectedLocationId] = useState(() => locationId || locations[0]?.id || "");
  const [draft, setDraft] = useState(() => initialDraft(defaults));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setError("");
  }

  async function submit(event) {
    event.preventDefault();
    if (!selectedLocationId || !draft.partNumber.trim() || !draft.description.trim() || !draft.trackingMode) {
      setError("Choose a location, enter the part details, and choose how the part is tracked.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/office/inventory/parts", {
        method: "POST",
        body: JSON.stringify({
          locationId: selectedLocationId,
          partNumber: draft.partNumber,
          description: draft.description,
          uomCode: draft.uomCode,
          trackingMode: draft.trackingMode,
          manufacturer: draft.manufacturer,
          category: draft.category,
          barcode: "",
          referenceNumbers: draft.referenceNumber.trim() ? [draft.referenceNumber.trim()] : [],
        }),
      });
      await onCreated?.(result.part);
      onClose?.();
    } catch (nextError) {
      setError(nextError.message || "Part could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return <ModalOverlay className="create-inventory-part-overlay" isOpen isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) onClose?.(); }}>
    <Modal className="create-inventory-part-modal">
      <Dialog className="create-inventory-part-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <form onSubmit={submit} noValidate>
          <header>
            <div><Heading slot="title" id={titleId}>Create inventory part</Heading><p id={descriptionId}>Available now in local inventory. No quantity or Odoo record will be created.</p></div>
            <button type="button" aria-label="Close create part" onClick={onClose} disabled={busy}><XClose aria-hidden="true" /></button>
          </header>
          {error ? <p className="create-inventory-part-error" role="alert" aria-live="assertive">{error}</p> : null}
          <div className="create-inventory-part-fields">
            {!locationId ? <label htmlFor={locationInputId}><span>Location</span><Dropdown id={locationInputId} value={selectedLocationId} onChange={(event) => { setSelectedLocationId(event.target.value); setError(""); }} disabled={busy} required><option value="">Choose location</option>{locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}</Dropdown></label> : null}
            <label htmlFor={partNumberId}><span>Part number</span><input id={partNumberId} autoFocus autoComplete="off" required maxLength={200} value={draft.partNumber} onChange={(event) => update("partNumber", event.target.value)} disabled={busy} /></label>
            <label htmlFor={partNameId}><span>Part name</span><input id={partNameId} autoComplete="off" required maxLength={1000} value={draft.description} onChange={(event) => update("description", event.target.value)} disabled={busy} /></label>
            <div className="create-inventory-part-unit"><span>Unit</span><UnitOfMeasurePicker uomCode={draft.uomCode} onChange={(value) => update("uomCode", value)} disabled={busy} /></div>
            <label><span>How do you track this part?</span><Dropdown value={draft.trackingMode} onChange={(event) => update("trackingMode", event.target.value)} disabled={busy} required><option value="">Choose tracking</option><option value="quantity">Quantity — small interchangeable parts</option><option value="serialized">Serialized — one identity per physical unit</option><option value="measured_bulk">Measured or bulk — fluids and divisible material</option></Dropdown><small>This applies at every location.</small></label>
          </div>
          <details>
            <summary>Optional details</summary>
            <div className="create-inventory-part-fields">
              <label htmlFor={manufacturerId}><span>Manufacturer</span><input id={manufacturerId} autoComplete="off" maxLength={240} value={draft.manufacturer} onChange={(event) => update("manufacturer", event.target.value)} disabled={busy} /></label>
              <label htmlFor={categoryId}><span>Category</span><input id={categoryId} autoComplete="off" maxLength={240} value={draft.category} onChange={(event) => update("category", event.target.value)} disabled={busy} /></label>
              <label htmlFor={referenceId}><span>Odoo or supplier number</span><input id={referenceId} autoComplete="off" maxLength={200} value={draft.referenceNumber} onChange={(event) => update("referenceNumber", event.target.value)} disabled={busy} /><small>A later Odoo sync can match this unique reference.</small></label>
            </div>
          </details>
          <footer><Button type="button" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? "Creating…" : "Create part"}</Button></footer>
        </form>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
