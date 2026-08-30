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
import { createSerializedRepairAutosave } from "./serialized-repair-autosave.js";
import {
  mechanicWorkStorageKey,
  removeLegacyMechanicWorkStorage,
} from "../../features/mechanic/progress/mechanic-work-storage.js";
import "./used-parts-editor.css";
import { PartCatalogCombobox } from "./part-requests/PartCatalogCombobox.jsx";
import { RepairHistorySuggestions } from "./part-requests/RepairHistorySuggestions.jsx";
import {
  catalogInventoryText,
  repairOrderAfterCatalogSelection,
} from "./part-requests/catalog-parts-model.js";
import { laborProductLabel } from "../../../../shared/labor-product.js";
import { formatLocaleNumber, interfaceText } from "../../i18n/index.js";

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
  installedParts = [],
  onLaborHoursChange = () => {},
  onLaborRepairOrderChange = () => {},
  onChange,
  onSave,
  onChanged = () => {},
  onRegisterSerializedRepairFlush = () => {},
  disabled = false,
  defaultRows,
  suggestionsEnabled = true,
  locale = "en",
  readonlyMessage = "Used parts are read-only for your role.",
}) {
  const t = (key) => interfaceText(locale, key);
  const readOnlyText = locale === "en" ? readonlyMessage : t("parts.usedPartsReadOnly");
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
  const [serializedRepairOrders, setSerializedRepairOrders] = useState({});
  const [savingSerializedUsageId, setSavingSerializedUsageId] = useState("");
  const serializedRepairContextRef = useRef(null);
  const serializedRepairAutosaveRef = useRef(null);
  serializedRepairContextRef.current = { detail, locale, onChanged };
  if (!serializedRepairAutosaveRef.current) {
    serializedRepairAutosaveRef.current = createSerializedRepairAutosave({
      save: async (part, repairOrder) => {
        const context = serializedRepairContextRef.current;
        await api(`/api/workorders/${encodeURIComponent(context.detail.workorder.id)}/modules/parts/actions/record`, {
          method: "POST",
          body: JSON.stringify({
            operation: "serializedUsageRepairOrder",
            usageId: part.usageId,
            repairOrder,
          }),
        });
        await context.onChanged();
      },
      onSaving: (usageId, saving) => setSavingSerializedUsageId((current) => (
        saving ? usageId : current === usageId ? "" : current
      )),
      onSaved: (usageId, repairOrder) => setSerializedRepairOrders((current) => {
        if (current[usageId] !== repairOrder) return current;
        const next = { ...current };
        delete next[usageId];
        return next;
      }),
      onError: (error) => {
        const context = serializedRepairContextRef.current;
        setMessage(context.locale === "en" && error?.message
          ? error.message
          : interfaceText(context.locale, "parts.saveFailed"));
      },
    });
  }
  const serializedRepairAutosave = serializedRepairAutosaveRef.current;

  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    onRegisterSerializedRepairFlush(serializedRepairAutosave.flushAll);
    return () => {
      onRegisterSerializedRepairFlush(null);
      serializedRepairAutosave.dispose();
    };
  }, [onRegisterSerializedRepairFlush, serializedRepairAutosave]);

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
        setMessage(t("parts.recoveredUnsavedEntries"));
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
    setSaveState(t("progress.saving"));
    const timer = window.setTimeout(async () => {
      try {
        await saveRef.current(rows, String(laborHours || ""));
        persistedRef.current = savePayload;
        window.localStorage.removeItem(storageKey);
        setSaveState(t("progress.saved"));
      } catch (error) {
        setSaveState(t("progress.notSaved"));
        setMessage(locale === "en" && error?.message ? error.message : t("parts.saveFailed"));
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

  function serializedRepairOrder(part) {
    return Object.hasOwn(serializedRepairOrders, part.usageId)
      ? serializedRepairOrders[part.usageId]
      : part.repairOrder;
  }

  function updateSerializedRepairOrder(part, repairOrder) {
    if (!part.usageId) return;
    setSerializedRepairOrders((current) => ({ ...current, [part.usageId]: repairOrder }));
    setMessage("");
    serializedRepairAutosave.update(part, repairOrder);
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
      setMessage(t("parts.detailsFound"));
    } catch {
      setMessage(t("parts.detailsUnavailable"));
    } finally {
      setFindingRow(-1);
    }
  }

  if (disabled) {
    const savedParts = [...installedParts, ...readonlyUsedParts(parts)];
    return (
      <div className="used-parts-editor is-readonly" aria-label={t("parts.usedTitle")}>
        <p className="used-parts-readonly-state" role="status">{readOnlyText}</p>
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
                <strong>{part.partNo || t("parts.partNumberNotRecorded")}</strong>
                <span>{formatQuantityUnit(part.qty, part.uomCode)}</span>
                {part.repairOrder ? <span>{part.repairOrder}</span> : null}
              </li>
            ))}
          </ul>
        ) : <p className="used-parts-empty">{t("parts.noUsedPartsRecorded")}</p>}
      </div>
    );
  }

  return (
    <div className="used-parts-editor">
      <div className="parts-editor">
        <div className="part-row part-row-head" aria-hidden="true">
          <span>{t("parts.serialNumber")}</span>
          <span>{t("parts.partNumber")}</span>
          <span>{t("parts.quantityUnit")}</span>
          <span>{t("parts.repairOrder")}</span>
          <span></span>
        </div>
        <div className="part-row used-part-labor-row">
          <strong>1</strong>
          <div className="used-part-field">
            <span className="used-part-label">{t("parts.labor")}</span>
            <strong className="used-part-labor-name">{laborProductLabel(laborProduct)}</strong>
          </div>
          <div className="used-part-field used-part-quantity">
            <QuantityUnitInput
              id="workorder-labor-hours"
              quantity={laborHours}
              uomCode="hr"
              onValueChange={({ quantity }) => onLaborHoursChange(quantity)}
              quantityLabel={t("parts.laborHours")}
              unitLabel={t("parts.unit")}
              disabled={disabled || laborRepairOrderDisabled}
              unitReadOnly
              compact
              max={9999}
            />
          </div>
          <div className="used-part-field used-part-repair">
            <NarrativeField
              locale={locale}
              singleLine
              value={laborRepairOrder}
              onChange={(event) => onLaborRepairOrderChange(event.target.value)}
              aria-label={t("parts.repairOrderWorkPerformed")}
              placeholder={t("parts.repairOrderWorkPerformed")}
              disabled={disabled || laborRepairOrderDisabled}
            />
          </div>
          <span aria-hidden="true"></span>
        </div>
        {installedParts.map((part, index) => (
          <div
            className="part-row used-part-serialized-row"
            key={`serialized-${part.catalogPartId || part.partNo}-${index}`}
            aria-label={`${part.partNo}, ${formatQuantityUnit(part.qty, part.uomCode)}, ${t("parts.installed")}`}
          >
            <strong>{index + 2}</strong>
            <div className="used-part-field">
              <strong>{part.partNo}</strong>
              {part.serialNumber ? <small>{part.serialNumber}</small> : null}
              <small>{t("parts.serialized")}</small>
            </div>
            <div className="used-part-field used-part-serialized-value">
              <strong>{formatQuantityUnit(part.qty, part.uomCode)}</strong>
            </div>
            <div className="used-part-field used-part-repair">
              <NarrativeField
                locale={locale}
                singleLine
                value={serializedRepairOrder(part)}
                onChange={(event) => updateSerializedRepairOrder(part, event.target.value)}
                onBlur={() => serializedRepairAutosave.flushOne(part)}
                aria-label={`${t("parts.repairOrder")} ${index + 2}`}
                placeholder={t("parts.describeRepair")}
                disabled={disabled || !part.usageId}
              />
              {suggestionsEnabled && part.catalogPartId && part.usageId ? <RepairHistorySuggestions
                workorderId={detail.workorder.id}
                catalogPartId={part.catalogPartId}
                partNumber={part.partNo}
                assetId={detail.workorder.asset?.id || detail.workorder.assetId}
                onApply={(text) => updateSerializedRepairOrder(part, text)}
                disabled={disabled || !part.usageId || savingSerializedUsageId === part.usageId}
                locale={locale}
              /> : null}
            </div>
            <span className="used-part-serialized-status">{savingSerializedUsageId === part.usageId ? t("progress.saving") : t("parts.installed")}</span>
          </div>
        ))}
        {rows.map((part, index) => (
          <div className="part-row" key={index}>
            <strong>{installedParts.length + index + 2}</strong>
            <div className="used-part-field">
              <span className="used-part-label">{t("parts.partNumber")}</span>
              <div className={`used-part-number-control ${suggestionsEnabled ? "has-suggestion" : ""}`}>
                <PartCatalogCombobox
                  workorderId={detail.workorder.id}
                  purpose="issue"
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
                      repairOrder: repairOrderAfterCatalogSelection(part.repairOrder, catalogPart),
                    });
                    setMessage(catalogInventoryText(catalogPart, t, (value) => formatLocaleNumber(value, locale)));
                  }}
                  label={`${t("parts.partNumber")} ${index + 1}`}
                  inputAriaLabel={`${t("parts.partNumber")} ${index + 1}`}
                  inputPolicy="identifier"
                  placeholder={t("parts.partNumber")}
                  disabled={disabled}
                  locale={locale}
                />
                {suggestionsEnabled ? (
                  <button type="button" onClick={() => suggestRepair(index)} disabled={disabled || findingRow >= 0 || !looksLikePartNumber(part.partNo)} title={t("parts.findDetails")} aria-label={`${t("parts.findDetails")} ${index + 1}`}>
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
                quantityLabel={`${t("parts.quantity")} ${index + 1}`}
                unitLabel={`${t("parts.unit")} ${index + 1}`}
                disabled={disabled}
                compact
              />
            </div>
            <div className="used-part-field used-part-repair">
              <NarrativeField
                locale={locale}
                singleLine
                value={part.repairOrder}
                onChange={(event) => update(index, "repairOrder", event.target.value)}
                aria-label={`${t("parts.repairOrder")} ${index + 1}`}
                placeholder={t("parts.describeRepair")}
                disabled={disabled}
              />
            </div>
            <button className="remove-row" type="button" onClick={() => removeRow(index)} disabled={disabled} aria-label={`${t("parts.removePartRow")} ${index + 1}`}>{t("parts.remove")}</button>
            {selectedCatalogParts[index]?.id ? <div className="used-part-history">
              <RepairHistorySuggestions
                workorderId={detail.workorder.id}
                catalogPartId={selectedCatalogParts[index]?.id}
                partNumber={selectedCatalogParts[index]?.partNumber}
                assetId={detail.workorder.asset?.id || detail.workorder.assetId}
                onApply={(text) => update(index, "repairOrder", text)}
                disabled={disabled}
                locale={locale}
              />
            </div> : null}
          </div>
        ))}
      </div>
      <Button icon={Plus} onClick={addRow} disabled={rows.length >= MAX_USED_PARTS}>
        {rows.length ? t("parts.addAnotherPart") : t("parts.recordUsedPart")}
      </Button>
      <div className="used-parts-feedback" aria-live="polite">
        {message ? <span>{message}</span> : <span></span>}
        {saveState ? <strong>{saveState}</strong> : null}
      </div>
    </div>
  );
}
