import { Dropdown } from "../../forms/Dropdown.jsx";
import { useId, useState } from "react";
import { Plus, SearchMd } from "@untitledui/icons";
import { api } from "../../../lib/api.js";
import { NarrativeField } from "../../forms/NarrativeField.jsx";
import { QuantityUnitInput } from "../../forms/QuantityUnitInput.jsx";
import { textEntryProps } from "../../forms/text-entry-policy.js";
import { Button } from "../../ui/Button.jsx";
import { normalizeUomCode } from "../../../../../shared/units-of-measure.js";
import {
  createEmptyPartDraft,
  purchasingLocation,
  SOURCE_LABELS,
  vehicleInput,
  partRequestLabel,
} from "./part-request-model.js";
import { PartCatalogCombobox } from "./PartCatalogCombobox.jsx";
import { RepairHistorySuggestions } from "./RepairHistorySuggestions.jsx";
import { catalogInventoryText } from "./catalog-parts-model.js";
import { formatLocaleNumber } from "../../../i18n/index.js";
import { interfaceText } from "../../../i18n/index.js";

export function OfficePartComposer({ detail, onChanged }) {
  const locale = "en";
  const t = (key) => interfaceText(locale, key);
  const sourceOptions = Object.entries(SOURCE_LABELS).map(([value, label]) => [value, partRequestLabel(locale, "source", value, label)]);
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(createEmptyPartDraft);
  const [sourceType, setSourceType] = useState("unknown");
  const [selectedPart, setSelectedPart] = useState(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function clearCatalogSelection() {
    setSelectedPart(null);
    if (sourceType === "inventory") setSourceType("unknown");
  }

  async function identify() {
    setBusy("identify");
    setMessage("");
    try {
      const result = await api("/api/parts-helper/identify", {
        method: "POST",
        body: JSON.stringify({ query: draft.query, vehicle: vehicleInput(detail), location: purchasingLocation(detail) }),
      });
      setDraft((current) => ({
        ...current,
        partNumber: result.part.normalizedPartNumber || current.query,
        manufacturer: result.part.manufacturer,
        description: result.part.description,
        category: result.part.category,
        quantity: result.part.suggestedQuantity || 1,
        uomCode: normalizeUomCode(result.part.uomCode || current.uomCode),
        fitmentStatus: result.part.fitmentStatus,
        fitmentNotes: result.part.evidenceSummary,
      }));
      clearCatalogSelection();
      setMessage(result.resolutionSource === "company_catalog"
        ? t("parts.companyPartFilled")
        : result.part.status === "ambiguous"
          ? t("parts.exactInputPreserved")
          : t("parts.aiSuggestionFilled"));
    } catch (error) {
      setMessage(locale === "en" && error?.message ? `${error.message} ${t("parts.manualEntryAvailable")}` : t("parts.identifyFailed"));
      if (!draft.partNumber) update("partNumber", draft.query);
    } finally {
      setBusy("");
    }
  }

  async function addPart() {
    setBusy("submit");
    setMessage("");
    try {
      const inventory = selectedPart?.inventory;
      const usesSelectedInventory = sourceType === "inventory" && inventory?.itemId;
      await api(`/api/office/workorders/${detail.workorder.id}/part-plans`, {
        method: "POST",
        body: JSON.stringify({
          ...draft,
          ...(selectedPart?.id ? { catalogPartId: selectedPart.id } : {}),
          allocations: [{
            sourceType,
            status: sourceType === "inventory" ? "reserved" : "proposed",
            quantity: draft.quantity,
            uomCode: draft.uomCode,
            ...(usesSelectedInventory ? {
              inventoryItemId: inventory.itemId,
              locationId: inventory.locationId,
            } : {}),
          }],
        }),
      });
      setDraft(createEmptyPartDraft());
      setSelectedPart(null);
      setSourceType("unknown");
      setOpen(false);
      await onChanged();
    } catch (error) {
      setMessage(locale === "en" && error?.message ? error.message : t("parts.savePlanFailed"));
    } finally {
      setBusy("");
    }
  }

  if (!open) {
    return (
      <Button icon={Plus} aria-controls={formId} aria-expanded={false} onClick={() => setOpen(true)}>
        {t("parts.planSourcePart")}
      </Button>
    );
  }

  return (
    <div className="office-add-part" id={formId}>
      <div className="office-add-part-head">
        <div>
          <strong>{t("parts.planSourcePart")}</strong>
        </div>
        <button type="button" onClick={() => setOpen(false)}>{t("parts.cancel")}</button>
      </div>
      <div className="part-search-control">
        <PartCatalogCombobox
          workorderId={detail.workorder.id}
          purpose="request"
          value={draft.query}
          onChange={(value) => {
            update("query", value);
            clearCatalogSelection();
          }}
          onSelect={(part) => {
            setSelectedPart(part);
            setDraft((current) => ({
              ...current,
              query: part.partNumber,
              partNumber: part.partNumber,
              manufacturer: part.manufacturer,
              description: part.description,
              category: part.category,
              quantity: current.quantity || 1,
              uomCode: normalizeUomCode(part.uomCode || current.uomCode),
            }));
            setSourceType(part.inventory.available > 0 && part.inventory.itemId ? "inventory" : "unknown");
            setMessage(catalogInventoryText(part, t, (value) => formatLocaleNumber(value, locale)));
          }}
          disabled={Boolean(busy)}
          allowAiFallback
        />
        <div className="part-search-ai-action">
          <button type="button" onClick={identify} disabled={draft.query.trim().length < 2 || Boolean(busy)}><SearchMd /> {busy === "identify" ? t("parts.finding") : t("parts.find")}</button>
          <small>{t("parts.aiFallback")}</small>
        </div>
      </div>
      <div className="part-suggestion-fields">
        <label>{t("parts.partNumber")}<input {...textEntryProps("identifier")} value={draft.partNumber} onChange={(event) => {
          update("partNumber", event.target.value);
          clearCatalogSelection();
        }} /></label>
        <QuantityUnitInput
          id="office-part-quantity"
          quantity={draft.quantity}
          uomCode={draft.uomCode}
          onQuantityChange={(value) => update("quantity", value)}
          onUomCodeChange={(value) => {
            update("uomCode", value);
            clearCatalogSelection();
          }}
          quantityLabel={t("parts.quantity")}
          unitLabel={t("parts.unit")}
        />
        <label className="part-field-wide">{t("parts.description")}<NarrativeField singleLine value={draft.description} onChange={(event) => update("description", event.target.value)} /></label>
        <label className="part-field-wide">{t("parts.repairOrder")}<input {...textEntryProps("identifier")} value={draft.repairOrder} onChange={(event) => update("repairOrder", event.target.value)} /></label>
        <div className="part-field-wide">
          <RepairHistorySuggestions
            workorderId={detail.workorder.id}
            catalogPartId={selectedPart?.id}
            partNumber={selectedPart?.partNumber}
            assetId={detail.workorder.asset?.id || detail.workorder.assetId}
            currentRepairOrder={draft.repairOrder}
            onApply={(text) => update("repairOrder", text)}
            disabled={Boolean(busy)}
          />
        </div>
        <label>{t("parts.fitment")}
          <Dropdown value={draft.fitmentStatus} onChange={(event) => update("fitmentStatus", event.target.value)}>
            <option value="unknown">{t("parts.fitment.unknown")}</option>
            <option value="possible">{t("parts.fitment.possible")}</option>
            <option value="confirmed">{t("parts.fitment.confirmed")}</option>
            <option value="conflict">{t("parts.fitment.conflict")}</option>
          </Dropdown>
        </label>
        <label>{t("parts.supply")}
          <Dropdown value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
            {sourceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Dropdown>
        </label>
      </div>
      <Button variant="primary" onClick={addPart} disabled={draft.query.trim().length < 2 || Number(draft.quantity) < 1 || Boolean(busy)}>
        {busy === "submit" ? t("parts.planning") : t("parts.savePartPlan")}
      </Button>
      {message ? <p className="part-request-message" role="status">{message}</p> : null}
    </div>
  );
}
