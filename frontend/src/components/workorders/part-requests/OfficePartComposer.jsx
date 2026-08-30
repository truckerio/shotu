import { Dropdown } from "../../forms/Dropdown.jsx";
import { useState } from "react";
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
} from "./part-request-model.js";
import { PartCatalogCombobox } from "./PartCatalogCombobox.jsx";
import { RepairHistorySuggestions } from "./RepairHistorySuggestions.jsx";
import { catalogInventoryText } from "./catalog-parts-model.js";

export function OfficePartComposer({ detail, onChanged }) {
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
        ? "Company-approved part filled. Verify fitment for this unit."
        : result.part.status === "ambiguous"
          ? "Exact input preserved. Review the AI suggestion before approval."
          : "AI suggestion filled. Office remains responsible for fitment.");
    } catch (error) {
      setMessage(`${error.message} Manual entry remains available.`);
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
      await api(`/api/office/workorders/${detail.workorder.id}/parts`, {
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
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  }

  if (!open) {
    return (
      <Button icon={Plus} onClick={() => setOpen(true)}>
        Add approved part
      </Button>
    );
  }

  return (
    <div className="office-add-part">
      <div className="office-add-part-head">
        <strong>Add approved part</strong>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <div className="part-search-control">
        <PartCatalogCombobox
          workorderId={detail.workorder.id}
          purpose="issue"
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
            setMessage(catalogInventoryText(part));
          }}
          disabled={Boolean(busy)}
          allowAiFallback
        />
        <div className="part-search-ai-action">
          <button type="button" onClick={identify} disabled={draft.query.trim().length < 2 || Boolean(busy)}><SearchMd /> {busy === "identify" ? "Finding" : "Find"}</button>
          <small>AI fallback</small>
        </div>
      </div>
      <div className="part-suggestion-fields">
        <label>Part number<input {...textEntryProps("identifier")} value={draft.partNumber} onChange={(event) => {
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
          quantityLabel="Quantity"
          unitLabel="Unit"
        />
        <label className="part-field-wide">Description<NarrativeField singleLine value={draft.description} onChange={(event) => update("description", event.target.value)} /></label>
        <label className="part-field-wide">Repair order<input {...textEntryProps("identifier")} value={draft.repairOrder} onChange={(event) => update("repairOrder", event.target.value)} /></label>
        <div className="part-field-wide">
          <RepairHistorySuggestions
            workorderId={detail.workorder.id}
            catalogPartId={selectedPart?.id}
            partNumber={selectedPart?.partNumber}
            assetId={detail.workorder.asset?.id || detail.workorder.assetId}
            onApply={(text) => update("repairOrder", text)}
            disabled={Boolean(busy)}
          />
        </div>
        <label>Fitment
          <Dropdown value={draft.fitmentStatus} onChange={(event) => update("fitmentStatus", event.target.value)}>
            <option value="unknown">Not verified</option>
            <option value="possible">Possible</option>
            <option value="confirmed">Confirmed</option>
            <option value="conflict">Conflict</option>
          </Dropdown>
        </label>
        <label>Supply
          <Dropdown value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Dropdown>
        </label>
      </div>
      <Button variant="primary" onClick={addPart} disabled={draft.query.trim().length < 2 || Number(draft.quantity) < 1 || Boolean(busy)}>
        {busy === "submit" ? "Adding" : "Add approved part"}
      </Button>
      {message ? <p className="part-request-message" role="status">{message}</p> : null}
    </div>
  );
}
