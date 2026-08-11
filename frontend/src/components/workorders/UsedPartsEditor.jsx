import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, SearchMd } from "@untitledui/icons";
import { api } from "../../lib/api.js";
import { QuantityUnitInput } from "../forms/QuantityUnitInput.jsx";
import { NarrativeField } from "../forms/NarrativeField.jsx";
import { formatQuantityUnit } from "../forms/quantity-unit-model.js";
import { Button } from "../ui/Button.jsx";
import {
  MAX_USED_PARTS,
  addUsedPart,
  defaultUsedPartQuantity,
  initialUsedPartRows,
  normalizeUsedParts,
  readonlyUsedParts,
  removeUsedPart,
  usedPartQuantityAfterPartNumberChange,
} from "./used-parts-model.js";
import {
  mechanicWorkStorageKey,
  removeLegacyMechanicWorkStorage,
} from "../../features/mechanic/progress/mechanic-work-storage.js";
import "./used-parts-editor.css";
import { PartCatalogCombobox } from "./part-requests/PartCatalogCombobox.jsx";
import { RepairHistorySuggestions } from "./part-requests/RepairHistorySuggestions.jsx";
import { catalogInventoryText } from "./part-requests/catalog-parts-model.js";
import { laborProductLabel } from "../../../../shared/labor-product.js";

function vehicleInput(detail) {
  const asset = detail.workorder.asset || {};
  return {
    assetId: asset.id || detail.workorder.assetId || undefined,
    unitNo: asset.unitNo || asset.name || "",
    vin: asset.vin || detail.workorder.formData?.vinNo || "",
    make: asset.make || "",
    model: asset.model || detail.workorder.formData?.model || "",
    year: asset.year || undefined,
    engine: detail.workorder.formData?.engine || "",
  };
}

function purchasingLocation(detail) {
  const name = detail.workorder.location?.name || "Chino";
  return {
    country: "US",
    city: name.replace(/\s+yard$/i, "") || "Chino",
    region: "CA",
    timezone: "America/Los_Angeles",
  };
}

function looksLikePartNumber(value) {
  const text = String(value || "").trim();
  return text.length >= 3 && /\d/.test(text) && !/\s/.test(text) && /^[a-z0-9._/-]+$/i.test(text);
}

export function UsedPartsEditor({
  actorId,
  detail,
  parts,
  laborHours = "",
  laborProduct = null,
  laborRepairOrder = "",
  laborRepairOrderDisabled = false,
  onLaborHoursChange = () => {},
  onLaborRepairOrderChange = () => {},
  onChange,
  onSave,
  disabled = false,
  defaultRows,
  suggestionsEnabled = true,
  readonlyMessage = "Used parts are read-only for your role.",
}) {
  const [visibleRowCount, setVisibleRowCount] = useState(() => initialUsedPartRows(parts, defaultRows).length);
  const rows = useMemo(
    () => normalizeUsedParts(parts, visibleRowCount),
    [parts, visibleRowCount],
  );
  const savePayload = useMemo(
    () => JSON.stringify({ parts: rows, laborHours: String(laborHours || "") }),
    [laborHours, rows],
  );
  const storageKey = actorId
    ? mechanicWorkStorageKey("used-parts", actorId, detail.workorder.id)
    : "";
  const persistedRef = useRef(savePayload);
  const hydratedRef = useRef(false);
  const saveRef = useRef(onSave);
  const [findingRow, setFindingRow] = useState(-1);
  const [saveState, setSaveState] = useState("");
  const [message, setMessage] = useState("");
  const [selectedCatalogParts, setSelectedCatalogParts] = useState([]);

  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    const currentRows = initialUsedPartRows(parts, defaultRows);
    setVisibleRowCount(currentRows.length);
    hydratedRef.current = false;
    persistedRef.current = JSON.stringify({ parts: currentRows, laborHours: String(laborHours || "") });
    setSaveState("");
    setMessage("");
    setSelectedCatalogParts([]);

    hydratedRef.current = true;
    removeLegacyMechanicWorkStorage();
    if (!storageKey) return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) return;
      const storedValue = JSON.parse(stored);
      const recovered = initialUsedPartRows(Array.isArray(storedValue) ? storedValue : storedValue.parts, defaultRows);
      const recoveredLaborHours = Array.isArray(storedValue) ? laborHours : String(storedValue.laborHours || "");
      setVisibleRowCount(recovered.length);
      if (JSON.stringify(recovered) !== JSON.stringify(currentRows)) {
        onChange(recovered);
        setMessage("Recovered your unsaved part entries.");
      }
      if (recoveredLaborHours !== String(laborHours || "")) onLaborHoursChange(recoveredLaborHours);
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hydratedRef.current || disabled || !storageKey) return undefined;
    if (savePayload === persistedRef.current) return undefined;
    window.localStorage.setItem(storageKey, savePayload);
    setSaveState("Saving...");
    const timer = window.setTimeout(async () => {
      try {
        await saveRef.current(rows, String(laborHours || ""));
        persistedRef.current = savePayload;
        window.localStorage.removeItem(storageKey);
        setSaveState("Saved");
      } catch (error) {
        setSaveState("Not saved");
        setMessage(error.message);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [disabled, laborHours, rows, savePayload, storageKey]);

  function update(index, field, value) {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  function updateFields(index, fields) {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...fields } : row));
  }

  function addRow() {
    const next = addUsedPart(rows, rows.length);
    setVisibleRowCount(next.length);
    onChange(next);
  }

  function removeRow(index) {
    const normalized = removeUsedPart(rows, index, Math.max(0, rows.length - 1));
    setVisibleRowCount(normalized.length);
    setSelectedCatalogParts((current) => current.filter((_, rowIndex) => rowIndex !== index));
    onChange(normalized);
  }

  function setSelectedCatalogPart(index, part) {
    setSelectedCatalogParts((current) => {
      const next = [...current];
      next[index] = part;
      return next;
    });
  }

  async function suggestRepair(index) {
    const row = rows[index];
    if (!looksLikePartNumber(row.partNo)) return;
    setFindingRow(index);
    setMessage("");
    try {
      const result = await api("/api/parts-helper/identify", {
        method: "POST",
        body: JSON.stringify({
          query: row.partNo,
          vehicle: vehicleInput(detail),
          location: purchasingLocation(detail),
        }),
      });
      const next = [...rows];
      next[index] = {
        ...row,
        partNo: result.part.normalizedPartNumber || row.partNo,
        qty: defaultUsedPartQuantity(result.part.suggestedQuantity || row.qty),
        uomCode: result.part.uomCode || row.uomCode,
      };
      onChange(next);
      setMessage("Part details found. Choose a service-history suggestion or enter the repair order manually.");
    } catch (error) {
      setMessage(`${error.message} Manual entry is still available.`);
    } finally {
      setFindingRow(-1);
    }
  }

  if (disabled) {
    const savedParts = readonlyUsedParts(parts);
    return (
      <div className="used-parts-editor is-readonly" aria-label="Used parts">
        <p className="used-parts-readonly-state" role="status">{readonlyMessage}</p>
        {laborHours || laborRepairOrder ? (
          <ul className="used-parts-readonly-list">
            <li>
              <strong>{laborProductLabel(laborProduct)}</strong>
              <span>{laborHours} hr</span>
              {laborRepairOrder ? <span>{laborRepairOrder}</span> : null}
            </li>
          </ul>
        ) : null}
        {savedParts.length ? (
          <ul className="used-parts-readonly-list">
            {savedParts.map((part, index) => (
              <li key={`${part.partNo}-${index}`}>
                <strong>{part.partNo || "Part number not recorded"}</strong>
                <span>{formatQuantityUnit(part.qty, part.uomCode)}</span>
                {part.repairOrder ? <span>{part.repairOrder}</span> : null}
              </li>
            ))}
          </ul>
        ) : <p className="used-parts-empty">No used parts recorded.</p>}
      </div>
    );
  }

  return (
    <div className="used-parts-editor">
      <div className="parts-editor">
        <div className="part-row part-row-head" aria-hidden="true">
          <span>S.No</span>
          <span>Part no.</span>
          <span>Qty / unit</span>
          <span>Repair order</span>
          <span></span>
        </div>
        <div className="part-row used-part-labor-row">
          <strong>1</strong>
          <div className="used-part-field">
            <span className="used-part-label">Labor</span>
            <strong className="used-part-labor-name">{laborProductLabel(laborProduct)}</strong>
          </div>
          <div className="used-part-field used-part-quantity">
            <QuantityUnitInput
              id="workorder-labor-hours"
              quantity={laborHours}
              uomCode="hr"
              onValueChange={({ quantity }) => onLaborHoursChange(quantity)}
              quantityLabel="Labor hours"
              unitLabel="Unit"
              disabled={disabled || laborRepairOrderDisabled}
              unitReadOnly
              compact
              max={9999}
            />
          </div>
          <div className="used-part-field used-part-repair">
            <NarrativeField
              singleLine
              value={laborRepairOrder}
              onChange={(event) => onLaborRepairOrderChange(event.target.value)}
              aria-label="Labor repair order"
              placeholder="Repair order"
              disabled={disabled}
            />
          </div>
          <span aria-hidden="true"></span>
        </div>
        {rows.map((part, index) => (
          <div className="part-row" key={index}>
            <strong>{index + 2}</strong>
            <div className="used-part-field">
              <span className="used-part-label">Part number</span>
              <div className={`used-part-number-control ${suggestionsEnabled ? "has-suggestion" : ""}`}>
                <PartCatalogCombobox
                  workorderId={detail.workorder.id}
                  value={part.partNo}
                  onChange={(value) => {
                    setSelectedCatalogPart(index, null);
                    updateFields(index, {
                      partNo: value,
                      qty: usedPartQuantityAfterPartNumberChange(part, value),
                    });
                  }}
                  onSelect={(catalogPart) => {
                    setSelectedCatalogPart(index, catalogPart);
                    updateFields(index, {
                      partNo: catalogPart.partNumber,
                      qty: defaultUsedPartQuantity(part.qty),
                      uomCode: catalogPart.uomCode || part.uomCode,
                    });
                    setMessage(catalogInventoryText(catalogPart));
                  }}
                  label={`Part number ${index + 1}`}
                  inputAriaLabel={`Part number ${index + 1}`}
                  inputPolicy="identifier"
                  placeholder="Part number"
                  disabled={disabled}
                />
                {suggestionsEnabled ? (
                  <button type="button" onClick={() => suggestRepair(index)} disabled={disabled || findingRow >= 0 || !looksLikePartNumber(part.partNo)} title="Find part details" aria-label={`Find details for part in row ${index + 1}`}>
                    <SearchMd />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="used-part-field used-part-quantity">
              <QuantityUnitInput
                id={`used-part-quantity-${index}`}
                quantity={part.qty}
                uomCode={part.uomCode}
                onValueChange={({ quantity, uomCode }) => updateFields(index, { qty: quantity, uomCode })}
                quantityLabel={`Quantity ${index + 1}`}
                unitLabel={`Unit ${index + 1}`}
                disabled={disabled}
                compact
              />
            </div>
            <div className="used-part-field used-part-repair">
              <NarrativeField
                singleLine
                value={part.repairOrder}
                onChange={(event) => update(index, "repairOrder", event.target.value)}
                aria-label={`Repair order ${index + 1}`}
                placeholder="Describe repair for this part"
                disabled={disabled}
              />
            </div>
            <button className="remove-row" type="button" onClick={() => removeRow(index)} disabled={disabled} aria-label={`Remove part row ${index + 1}`}>Remove</button>
            {selectedCatalogParts[index]?.id ? <div className="used-part-history">
              <RepairHistorySuggestions
                workorderId={detail.workorder.id}
                catalogPartId={selectedCatalogParts[index]?.id}
                partNumber={selectedCatalogParts[index]?.partNumber}
                assetId={detail.workorder.asset?.id || detail.workorder.assetId}
                onApply={(text) => update(index, "repairOrder", text)}
                disabled={disabled}
              />
            </div> : null}
          </div>
        ))}
      </div>
      <Button icon={Plus} onClick={addRow} disabled={rows.length >= MAX_USED_PARTS}>
        {rows.length ? "Add another part" : "Record used part"}
      </Button>
      <div className="used-parts-feedback" aria-live="polite">
        {message ? <span>{message}</span> : <span></span>}
        {saveState ? <strong>{saveState}</strong> : null}
      </div>
    </div>
  );
}
