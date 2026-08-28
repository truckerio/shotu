import { useRef, useState } from "react";
import { Plus } from "@untitledui/icons";
import { api } from "../../lib/api.js";
import { NarrativeField } from "../forms/NarrativeField.jsx";
import { QuantityUnitInput } from "../forms/QuantityUnitInput.jsx";
import { Button } from "../ui/Button.jsx";
import { PartCatalogCombobox } from "./part-requests/PartCatalogCombobox.jsx";
import { catalogInventoryText } from "./part-requests/catalog-parts-model.js";
import { formatLocaleNumber, interfaceText } from "../../i18n/index.js";
import {
  createMechanicPartRequestDraft,
  mechanicPartRequestErrorFields,
  validateMechanicPartRequest,
} from "./mechanic-part-request-model.js";

export function MechanicPartRequestForm({ workorderId, onChanged, locale = "en" }) {
  const t = (key) => interfaceText(locale, key);
  const descriptionRef = useRef(null);
  const [draft, setDraft] = useState(createMechanicPartRequestDraft);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("error");
  const [catalogQuery, setCatalogQuery] = useState("");

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
    const validation = validateMechanicPartRequest(draft, t);
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
      setCatalogQuery("");
      setMessageTone("success");
      setMessage(t("parts.sent"));
    } catch (error) {
      const fieldErrors = mechanicPartRequestErrorFields(error);
      setErrors(fieldErrors);
      setMessageTone("error");
      setMessage(Object.keys(fieldErrors).length
        ? t("parts.checkFields")
        : locale === "en" && error?.message ? error.message : t("parts.requestFailed"));
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
        <strong>{t("parts.requestHeading")}</strong>
        <span>{t("parts.requestHelp")}</span>
      </div>
      <PartCatalogCombobox
        workorderId={workorderId}
        value={catalogQuery}
        onChange={(value) => {
          setCatalogQuery(value);
          setDraft((current) => ({ ...current, catalogPartId: "", partNumber: "" }));
        }}
        onSelect={(part) => {
          setCatalogQuery(part.partNumber);
          setDraft((current) => ({
            ...current,
            catalogPartId: part.id,
            partNumber: part.partNumber,
            query: part.description || part.partNumber,
            uomCode: part.uomCode || current.uomCode,
          }));
          setErrors({});
          setMessageTone("success");
          setMessage(catalogInventoryText(part, t, (value) => formatLocaleNumber(value, locale)));
        }}
        label={t("parts.catalogSearch")}
        placeholder={t("parts.numberOrDescription")}
        disabled={busy}
        locale={locale}
      />
      <label className="mechanic-part-description" htmlFor="mechanic-part-query">
        <span>{t("parts.description")}</span>
        <NarrativeField
          locale={locale}
          id="mechanic-part-query"
          ref={descriptionRef}
          value={draft.query}
          onChange={(event) => update("query", event.target.value)}
          placeholder={t("parts.example")}
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
          onUomCodeChange={(value) => {
            update("uomCode", value);
            setDraft((current) => ({ ...current, catalogPartId: "", partNumber: "" }));
          }}
          quantityLabel={t("parts.quantity")}
          unitLabel={t("parts.unit")}
          disabled={busy}
        />
        {errors.quantity ? <p className="part-field-error" id={quantityErrorId} role="alert">{errors.quantity}</p> : null}
        {errors.uomCode ? <p className="part-field-error" id={unitErrorId} role="alert">{errors.uomCode}</p> : null}
      </div>
      <Button type="submit" variant="primary" icon={Plus} disabled={busy}>
        {busy ? t("parts.sendingRequest") : t("parts.sendRequest")}
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
