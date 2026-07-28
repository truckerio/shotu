import { useEffect, useRef, useState } from "react";
import { Plus, SearchMd } from "@untitledui/icons";
import { emptyPart } from "../../../../shared/workorder-template.js";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.jsx";

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

function rowHasValue(part) {
  return Boolean(part?.partNo || part?.qty || part?.repairOrder || part?.requestId);
}

function normalizedRows(parts, minimumRows = 3) {
  const rows = Array.isArray(parts) ? parts.map((part) => ({
    partNo: String(part?.partNo || ""),
    qty: part?.qty === null || part?.qty === undefined ? "" : String(part.qty),
    repairOrder: String(part?.repairOrder || ""),
    ...(part?.requestId ? { requestId: part.requestId } : {}),
  })) : [];
  const minimum = Math.max(1, Math.min(18, Number(minimumRows) || 1));
  while (rows.length > minimum && !rowHasValue(rows.at(-1))) rows.pop();
  while (rows.length < minimum) rows.push(emptyPart());
  return rows.slice(0, 18);
}

function looksLikePartNumber(value) {
  const text = String(value || "").trim();
  return text.length >= 3 && /\d/.test(text) && !/\s/.test(text) && /^[a-z0-9._/-]+$/i.test(text);
}

export function UsedPartsEditor({
  detail,
  parts,
  onChange,
  onSave,
  disabled = false,
  minimumRows = 3,
  suggestionsEnabled = true,
}) {
  const minimum = Math.max(1, Math.min(18, Number(minimumRows) || 1));
  const [visibleRowCount, setVisibleRowCount] = useState(() => normalizedRows(parts, minimum).length);
  const rows = normalizedRows(parts, Math.max(minimum, visibleRowCount));
  const storageKey = `workorder-used-parts:${detail.workorder.id}`;
  const persistedRef = useRef(JSON.stringify(rows));
  const hydratedRef = useRef(false);
  const saveRef = useRef(onSave);
  const [findingRow, setFindingRow] = useState(-1);
  const [saveState, setSaveState] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    const currentRows = normalizedRows(parts, minimum);
    setVisibleRowCount(currentRows.length);
    hydratedRef.current = false;
    persistedRef.current = JSON.stringify(currentRows);
    setSaveState("");
    setMessage("");

    hydratedRef.current = true;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) return;
      const recovered = normalizedRows(JSON.parse(stored), minimum);
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
    if (!hydratedRef.current || disabled) return undefined;
    const payload = JSON.stringify(rows);
    if (payload === persistedRef.current) return undefined;
    window.localStorage.setItem(storageKey, payload);
    setSaveState("Saving...");
    const timer = window.setTimeout(async () => {
      try {
        await saveRef.current(rows);
        persistedRef.current = payload;
        window.localStorage.removeItem(storageKey);
        setSaveState("Saved");
      } catch (error) {
        setSaveState("Not saved");
        setMessage(error.message);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [disabled, rows, storageKey]);

  function update(index, field, value) {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  function addRow() {
    if (rows.length >= 18) return;
    const next = [...rows, emptyPart()];
    setVisibleRowCount(next.length);
    onChange(next);
  }

  function removeRow(index) {
    const next = rows.length <= minimum
      ? Array.from({ length: minimum }, emptyPart)
      : rows.filter((_, rowIndex) => rowIndex !== index);
    const normalized = normalizedRows(next, minimum);
    setVisibleRowCount(normalized.length);
    onChange(normalized);
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
        repairOrder: result.part.repairOrder || row.repairOrder,
      };
      onChange(next);
      setMessage("Repair order suggested. Review it before completing the workorder.");
    } catch (error) {
      setMessage(`${error.message} Manual entry is still available.`);
    } finally {
      setFindingRow(-1);
    }
  }

  return (
    <div className="used-parts-editor">
      <div className="parts-editor">
        <div className="part-row part-row-head" aria-hidden="true">
          <span>S.No</span>
          <span>Part no.</span>
          <span>Qty</span>
          <span>Repair order</span>
          <span></span>
        </div>
        {rows.map((part, index) => (
          <div className="part-row" key={index}>
            <strong>{index + 1}</strong>
            <label className="used-part-field">
              <span>Part number</span>
              <div className={`used-part-number-control ${suggestionsEnabled ? "has-suggestion" : ""}`}>
                <input value={part.partNo} onChange={(event) => update(index, "partNo", event.target.value)} aria-label={`Part number ${index + 1}`} placeholder="Part number" disabled={disabled} />
                {suggestionsEnabled ? (
                  <button type="button" onClick={() => suggestRepair(index)} disabled={disabled || findingRow >= 0 || !looksLikePartNumber(part.partNo)} title="Suggest repair order from part number" aria-label={`Suggest repair order for row ${index + 1}`}>
                    <SearchMd />
                  </button>
                ) : null}
              </div>
            </label>
            <label className="used-part-field">
              <span>Quantity</span>
              <input type="number" min="0" max="999" value={part.qty} onChange={(event) => update(index, "qty", event.target.value)} aria-label={`Quantity ${index + 1}`} placeholder="Qty" disabled={disabled} />
            </label>
            <label className="used-part-field">
              <span>Work performed</span>
              <input value={part.repairOrder} onChange={(event) => update(index, "repairOrder", event.target.value)} aria-label={`Work performed ${index + 1}`} placeholder="Work performed" disabled={disabled} />
            </label>
            <button className="remove-row" type="button" onClick={() => removeRow(index)} disabled={disabled || rows.length <= minimum} aria-label={`Remove part row ${index + 1}`}>Remove</button>
          </div>
        ))}
      </div>
      <Button icon={Plus} onClick={addRow} disabled={disabled || rows.length >= 18}>Add another part</Button>
      <div className="used-parts-feedback" aria-live="polite">
        {message ? <span>{message}</span> : <span></span>}
        {saveState ? <strong>{saveState}</strong> : null}
      </div>
    </div>
  );
}
