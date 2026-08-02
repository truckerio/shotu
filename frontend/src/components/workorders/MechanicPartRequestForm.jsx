import { useRef, useState } from "react";
import { Plus } from "@untitledui/icons";
import { api } from "../../lib/api.js";
import { NarrativeField } from "../forms/NarrativeField.jsx";
import { QuantityUnitInput } from "../forms/QuantityUnitInput.jsx";
import { Button } from "../ui/Button.jsx";
import {
  createMechanicPartRequestDraft,
  mechanicPartRequestErrorFields,
  validateMechanicPartRequest,
} from "./mechanic-part-request-model.js";

export function MechanicPartRequestForm({ workorderId, onChanged }) {
  const descriptionRef = useRef(null);
  const [draft, setDraft] = useState(createMechanicPartRequestDraft);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("error");

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setMessage("");
  }

  async function submit(event) {
    event.preventDefault();
    const validation = validateMechanicPartRequest(draft);
    if (Object.keys(validation.errors).length) {
      setErrors(validation.errors);
      setMessage("");
      if (validation.errors.query) descriptionRef.current?.focus();
      return;
    }

    setBusy(true);
    setErrors({});
    setMessage("");
    try {
      await api(`/api/mechanic/workorders/${workorderId}/parts`, {
        method: "POST",
        body: JSON.stringify(validation.payload),
      });
      await onChanged();
      setDraft(createMechanicPartRequestDraft());
      setMessageTone("success");
      setMessage("Part request sent to office.");
    } catch (error) {
      const fieldErrors = mechanicPartRequestErrorFields(error);
      setErrors(fieldErrors);
      setMessageTone("error");
      setMessage(Object.keys(fieldErrors).length
        ? "Check the highlighted fields. Your request is still here."
        : `${error.message || "The request could not be sent."} Your request is still here.`);
      if (fieldErrors.query) descriptionRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const queryErrorId = errors.query ? "mechanic-part-query-error" : undefined;
  const quantityErrorId = errors.quantity ? "mechanic-part-quantity-error" : undefined;
  const unitErrorId = errors.uomCode ? "mechanic-part-unit-error" : undefined;

  return (
    <form className="mechanic-part-request-form" onSubmit={submit} noValidate>
      <div className="mechanic-part-request-heading">
        <strong>Request a part</strong>
        <span>Tell the office what you need for this job.</span>
      </div>
      <label className="mechanic-part-description" htmlFor="mechanic-part-query">
        <span>What part do you need?</span>
        <NarrativeField
          id="mechanic-part-query"
          ref={descriptionRef}
          value={draft.query}
          onChange={(event) => update("query", event.target.value)}
          placeholder="Example: Front brake pads"
          rows="2"
          maxLength="500"
          disabled={busy}
          aria-invalid={Boolean(errors.query)}
          aria-describedby={queryErrorId}
        />
      </label>
      {errors.query ? <p className="part-field-error" id={queryErrorId} role="alert">{errors.query}</p> : null}
      <div
        className={`mechanic-part-request-quantity ${errors.quantity || errors.uomCode ? "has-error" : ""}`}
        aria-describedby={[quantityErrorId, unitErrorId].filter(Boolean).join(" ") || undefined}
      >
        <QuantityUnitInput
          id="mechanic-part-request-quantity"
          quantity={draft.quantity}
          uomCode={draft.uomCode}
          onQuantityChange={(value) => update("quantity", value)}
          onUomCodeChange={(value) => update("uomCode", value)}
          quantityLabel="Quantity"
          unitLabel="Unit"
          disabled={busy}
        />
        {errors.quantity ? <p className="part-field-error" id={quantityErrorId} role="alert">{errors.quantity}</p> : null}
        {errors.uomCode ? <p className="part-field-error" id={unitErrorId} role="alert">{errors.uomCode}</p> : null}
      </div>
      <Button type="submit" variant="primary" icon={Plus} disabled={busy}>
        {busy ? "Sending request" : "Send request"}
      </Button>
      {message ? (
        <p
          className={messageTone === "success" ? "part-request-message part-request-success" : "part-request-error"}
          role={messageTone === "success" ? "status" : "alert"}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
