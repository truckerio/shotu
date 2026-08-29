import { MinusCircle, Plus } from "@untitledui/icons";
import { useEffect, useId, useMemo, useState } from "react";
import { ActionFooter, FormErrorSummary, FormField, OperationalForm, textEntryProps } from "../../components/forms/index.js";
import { UnitOfMeasurePicker } from "../../components/forms/UnitOfMeasurePicker.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";
import { createPartIdentityDraft, MAX_REFERENCE_NUMBERS, partIdentityConflict, partIdentityPayload, validatePartIdentityDraft } from "./part-identity-editor-model.js";

function fieldIsEditable(part, field) {
  return (part.editableFields || []).includes(field);
}

export function PartIdentityEditor({ part, onCancel, onEditStateChange, onReload, onSaved }) {
  const [draft, setDraft] = useState(() => createPartIdentityDraft(part));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [message, setMessage] = useState("");
  const [focusKey, setFocusKey] = useState(0);
  const referenceHintId = useId();
  const providerManaged = Boolean(part.providerManaged);
  const uomEditable = fieldIsEditable(part, "uomCode") && part.uomLocked === false;
  const uomHint = providerManaged ? "Managed in Odoo. Edit the unit in Odoo." : "Unit is locked after inventory activity.";

  useEffect(() => {
    onEditStateChange?.({ busy, dirty: true });
    return () => onEditStateChange?.({ busy: false, dirty: false });
  }, [busy, onEditStateChange]);

  const canAddReference = draft.referenceNumbers.length < MAX_REFERENCE_NUMBERS && fieldIsEditable(part, "referenceNumbers");
  const summaryErrors = useMemo(() => ({
    ...errors,
    ...(conflict ? { conflict: conflict.message } : {}),
  }), [conflict, errors]);

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setConflict(false);
  }

  function updateReference(id, value) {
    setDraft((current) => ({
      ...current,
      referenceNumbers: current.referenceNumbers.map((reference) => reference.id === id ? { ...reference, value } : reference),
    }));
    setErrors((current) => ({ ...current, [`reference-${id}`]: undefined, referenceNumbers: undefined }));
    setConflict(false);
  }

  function addReference() {
    setDraft((current) => current.referenceNumbers.length >= MAX_REFERENCE_NUMBERS ? current : ({
      ...current,
      referenceNumbers: [...current.referenceNumbers, { id: crypto.randomUUID(), value: "" }],
    }));
  }

  function removeReference(id) {
    setDraft((current) => ({ ...current, referenceNumbers: current.referenceNumbers.filter((reference) => reference.id !== id) }));
    setErrors((current) => ({ ...current, [`reference-${id}`]: undefined }));
  }

  function reloadDetails() {
    setConflict(false);
    setMessage("Reloading current details.");
    onReload?.();
  }

  async function submit(event) {
    event.preventDefault();
    const nextErrors = validatePartIdentityDraft(draft);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      setFocusKey((value) => value + 1);
      return;
    }
    setBusy(true);
    setMessage("");
    setConflict(false);
    try {
      const result = await api(`/api/office/inventory/parts/${encodeURIComponent(part.catalogPartId)}`, {
        method: "PATCH",
        body: JSON.stringify(partIdentityPayload(draft, part.version)),
      });
      onSaved?.(result.part || result);
    } catch (error) {
      if (error.status === 409) {
        setConflict(partIdentityConflict(error));
        setFocusKey((value) => value + 1);
      } else {
        setMessage(error.message || "Part details could not be saved.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <OperationalForm className="inventory-part-editor" busy={busy} noValidate onSubmit={submit}>
      <FormErrorSummary errors={summaryErrors} focusFirstField focusKey={focusKey} focusOnMount title="Check part details" />
      {message ? <p className="inventory-part-editor-message" role="alert">{message}</p> : null}
      {conflict ? <div className="inventory-part-editor-conflict" role="alert">
        <span>{conflict.message}</span>
        {conflict.kind === "stale" ? <Button type="button" onClick={reloadDetails} disabled={busy}>Reload details</Button> : null}
      </div> : null}
      <div className="operational-form-grid two">
        <FormField id="inventory-part-name" label="Part name" error={errors.description} required>
          <input {...textEntryProps("name")} maxLength={1000} value={draft.description} onChange={(event) => update("description", event.target.value)} disabled={busy || !fieldIsEditable(part, "description")} />
        </FormField>
        <FormField id="inventory-primary-part-number" label="Primary part number" error={errors.partNumber} required>
          <input {...textEntryProps("identifier")} autoComplete="off" maxLength={200} value={draft.partNumber} onChange={(event) => update("partNumber", event.target.value)} disabled={busy || !fieldIsEditable(part, "partNumber")} />
        </FormField>
        <FormField id="inventory-manufacturer" label="Manufacturer">
          <input {...textEntryProps("name")} maxLength={240} value={draft.manufacturer} onChange={(event) => update("manufacturer", event.target.value)} disabled={busy || !fieldIsEditable(part, "manufacturer")} />
        </FormField>
        <FormField id="inventory-category" label="Category">
          <input {...textEntryProps("name")} maxLength={240} value={draft.category} onChange={(event) => update("category", event.target.value)} disabled={busy || !fieldIsEditable(part, "category")} />
        </FormField>
        <FormField id="inventory-catalog-barcode" label="Catalog barcode">
          <input {...textEntryProps("identifier")} autoComplete="off" maxLength={200} value={draft.barcode} onChange={(event) => update("barcode", event.target.value)} disabled={busy || !fieldIsEditable(part, "barcode")} />
        </FormField>
        <FormField id="inventory-unit" label="Unit" hint={!uomEditable ? uomHint : "Used for future inventory quantities."}>
          <UnitOfMeasurePicker uomCode={draft.uomCode} onChange={(value) => update("uomCode", value)} disabled={busy} readOnly={!uomEditable} />
        </FormField>
      </div>
      <section className="inventory-part-editor-references" aria-labelledby="inventory-reference-numbers-title" aria-describedby={referenceHintId}>
        <header><div><h4 id="inventory-reference-numbers-title">Reference numbers</h4><p id={referenceHintId}>Cross-reference, OEM, or supplier numbers. Up to {MAX_REFERENCE_NUMBERS}.</p></div>{canAddReference ? <Button type="button" icon={Plus} onClick={addReference} disabled={busy}>Add reference number</Button> : null}</header>
        {draft.referenceNumbers.map((reference, index) => <div className="inventory-part-editor-reference-row" key={reference.id}>
          <FormField id={`inventory-reference-${reference.id}`} label={`Reference number ${index + 1}`} error={errors[`reference-${reference.id}`]}>
            <input {...textEntryProps("identifier")} autoComplete="off" maxLength={200} value={reference.value} onChange={(event) => updateReference(reference.id, event.target.value)} disabled={busy || !fieldIsEditable(part, "referenceNumbers")} />
          </FormField>
          <button type="button" className="inventory-part-editor-remove" onClick={() => removeReference(reference.id)} disabled={busy || !fieldIsEditable(part, "referenceNumbers")} aria-label={`Remove reference number ${index + 1}`} title={`Remove reference number ${index + 1}`}><MinusCircle aria-hidden="true" /></button>
        </div>)}
        {!draft.referenceNumbers.length ? <p className="inventory-part-editor-empty">No reference numbers added.</p> : null}
      </section>
      {providerManaged ? <p className="inventory-part-editor-managed">Managed in Odoo. Only manufacturer and reference numbers can be changed here.</p> : null}
      <ActionFooter stickyOnMobile message={busy ? "Saving part details…" : ""}>
        <Button type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving" : "Save changes"}</Button>
      </ActionFooter>
    </OperationalForm>
  );
}
