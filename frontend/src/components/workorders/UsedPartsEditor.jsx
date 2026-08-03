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
  normalizeUsedParts,
  readonlyUsedParts,
  removeUsedPart,
} from "./used-parts-model.js";
import {
  mechanicWorkStorageKey,
  removeLegacyMechanicWorkStorage,
} from "../../features/mechanic/progress/mechanic-work-storage.js";
import "./used-parts-editor.css";
import { PartCatalogCombobox } from "./part-requests/PartCatalogCombobox.jsx";
import { RepairHistorySuggestions } from "./part-requests/RepairHistorySuggestions.jsx";
import { catalogInventoryText } from "./part-requests/catalog-parts-model.js";

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
  onChange,
  onSave,
  disabled = false,
  minimumRows = 0,
  suggestionsEnabled = true,
  readonlyMessage = "Used parts are read-only for your role.",
}) {
  const minimum = Math.max(0, Math.min(MAX_USED_PARTS, Number(minimumRows) || 0));
  const [visibleRowCount, setVisibleRowCount] = useState(() => normalizeUsedParts(parts, minimum).length);
  const rows = useMemo(
    () => normalizeUsedParts(parts, Math.max(minimum, visibleRowCount)),
    [minimum, parts, visibleRowCount],
  );
  const rowsPayload = useMemo(() => JSON.stringify(rows), [rows]);
  const storageKey = actorId
    ? mechanicWorkStorageKey("used-parts", actorId, detail.workorder.id)
    : "";
  const persistedRef = useRef(rowsPayload);
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
    const currentRows = normalizeUsedParts(parts, minimum);
    setVisibleRowCount(currentRows.length);
    hydratedRef.current = false;
    persistedRef.current = JSON.stringify(currentRows);
    setSaveState("");
    setMessage("");
    setSelectedCatalogParts([]);

    hydratedRef.current = true;
    removeLegacyMechanicWorkStorage();
    if (!storageKey) return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) return;
      const recovered = normalizeUsedParts(JSON.parse(stored), minimum);
      setVisibleRowCount(recovered.length);
      if (JSON.stringify(recovered) !== JSON.stringify(currentRows)) {
        onChange(recovered);
        setMessage("Recovered your unsaved part entries.");
      }
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hydratedRef.current || disabled || !storageKey) return undefined;
    if (rowsPayload === persistedRef.current) return undefined;
    window.localStorage.setItem(storageKey, rowsPayload);
    setSaveState("Saving...");
    const timer = window.setTimeout(async () => {
      try {
        await saveRef.current(rows);
        persistedRef.current = rowsPayload;
        window.localStorage.removeItem(storageKey);
        setSaveState("Saved");
      } catch (error) {
        setSaveState("Not saved");
        setMessage(error.message);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [disabled, rows, rowsPayload, storageKey]);

  function update(index, field, value) {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  function updateFields(index, fields) {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...fields } : row));
  }

  function addRow() {
    const next = addUsedPart(rows);
    setVisibleRowCount(next.length);
    onChange(next);
  }

  function removeRow(index) {
    const normalized = removeUsedPart(rows, index, minimum);
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
        qty: result.part.suggestedQuantity || row.qty,
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
      {!rows.length ? (
        <div className="used-parts-empty-state">
          <p>No used parts recorded.</p>
          <Button icon={Plus} onClick={addRow}>Add part</Button>
        </div>
      ) : null}
      {rows.length ? (
      <div className="parts-editor">
        <div className="part-row part-row-head" aria-hidden="true">
          <span>S.No</span>
          <span>Part no.</span>
          <span>Qty / unit</span>
          <span>Repair order</span>
          <span></span>
        </div>
        {rows.map((part, index) => (
          <div className="part-row" key={index}>
            <strong>{index + 1}</strong>
            <div className="used-part-field">
              <span className="used-part-label">Part number</span>
              <div className={`used-part-number-control ${suggestionsEnabled ? "has-suggestion" : ""}`}>
                <PartCatalogCombobox
                  workorderId={detail.workorder.id}
                  value={part.partNo}
                  onChange={(value) => {
                    setSelectedCatalogPart(index, null);
                    update(index, "partNo", value);
                  }}
                  onSelect={(catalogPart) => {
                    setSelectedCatalogPart(index, catalogPart);
                    updateFields(index, {
                      partNo: catalogPart.partNumber,
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
              <label>
                <span className="used-part-label">Repair order</span>
                <NarrativeField
                  singleLine
                  value={part.repairOrder}
                  onChange={(event) => update(index, "repairOrder", event.target.value)}
                  aria-label={`Repair order ${index + 1}`}
                  placeholder="Describe repair for this part"
                  disabled={disabled}
                />
              </label>
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
      ) : null}
      {rows.length ? <Button icon={Plus} onClick={addRow} disabled={rows.length >= MAX_USED_PARTS}>Add another part</Button> : null}
      <div className="used-parts-feedback" aria-live="polite">
        {message ? <span>{message}</span> : <span></span>}
        {saveState ? <strong>{saveState}</strong> : null}
      </div>
    </div>
  );
}
