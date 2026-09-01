import { Plus } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { QuantityUnitInput } from "../../../components/forms/index.js";
import { formatQuantityUnit } from "../../../components/forms/quantity-unit-model.js";
import { textEntryProps } from "../../../components/forms/text-entry-policy.js";
import { PartCatalogCombobox } from "../../../components/workorders/part-requests/PartCatalogCombobox.jsx";
import { repairOrderAfterCatalogSelection } from "../../../components/workorders/part-requests/catalog-parts-model.js";
import {
  defaultUsedPartQuantity,
  usedPartQuantityAfterPartNumberChange,
} from "../../../components/workorders/used-parts-model.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { useMediaQuery } from "../../../hooks/useMediaQuery.js";
import { laborProductLabel } from "../../../../../shared/labor-product.js";
import { interfaceText } from "../../../i18n/index.js";
import {
  createPartHasContent,
  createPartRenderIndexes,
  filledCreatePartIndexes,
  firstBlankCreatePartIndex,
  invalidCreatePartIndex,
} from "./create-parts-model.js";
import { CreatePartScanner } from "./CreatePartScanner.jsx";
import "./create-parts-module.css";

const COMPACT_PARTS_QUERY = "(max-width: 1024px)";

function LegacyCreatePartsEditor({
  canAddPart,
  errors,
  laborHours,
  laborLabel,
  laborRepairOrder,
  locale,
  locationId,
  onAdd,
  onChange,
  onLaborHoursChange,
  onLaborRepairOrderChange,
  onRemove,
  parts = [],
  t,
}) {
  return (
    <div className="create-known-parts-content">
      {errors?.parts ? <p className="operational-form-field-error" role="alert">{errors.parts}</p> : null}
      <div className="operational-parts-editor" id="create-known-parts-editor" tabIndex={-1}>
        <div className="operational-part-row has-quantity-unit operational-part-labor-row">
          <strong>1</strong>
          <div className="operational-part-labor-name"><strong>{laborLabel}</strong></div>
          <QuantityUnitInput
            id="create-workorder-labor-hours"
            quantity={laborHours}
            uomCode="hr"
            onValueChange={({ quantity }) => onLaborHoursChange(quantity)}
            quantityLabel={t("create.parts.laborHours")}
            unitLabel={t("create.parts.unit")}
            locale={locale}
            unitReadOnly
            compact
            max={9999}
          />
          <input
            {...textEntryProps("narrative")}
            className="operational-part-labor-repair"
            value={laborRepairOrder}
            onChange={(event) => onLaborRepairOrderChange(event.target.value)}
            aria-label={t("create.parts.repairWork")}
            placeholder={t("create.parts.repairWork")}
          />
          <span aria-hidden="true"></span>
        </div>
        {parts.map((part, index) => (
          <div className="operational-part-row has-quantity-unit" key={index}>
            <strong>{index + 2}</strong>
            <PartCatalogCombobox
              locationId={locationId}
              purpose="issue"
              value={part.partNo}
              onChange={(value) => onChange(index, {
                catalogPartId: null,
                partNo: value,
                qty: usedPartQuantityAfterPartNumberChange(part, value),
              })}
              onSelect={(catalogPart) => onChange(index, {
                catalogPartId: catalogPart.id,
                partNo: catalogPart.partNumber,
                qty: defaultUsedPartQuantity(part.qty),
                uomCode: catalogPart.uomCode || part.uomCode,
                repairOrder: repairOrderAfterCatalogSelection(part.repairOrder, catalogPart),
              })}
              label=""
              inputAriaLabel={`${t("create.parts.partNumber")} ${index + 1}`}
              placeholder={t("create.parts.numberOrDescription")}
              inputPolicy="identifier"
              locale={locale}
            />
            <QuantityUnitInput id={`known-part-quantity-${index}`} quantity={part.qty} uomCode={part.uomCode} onQuantityChange={(value) => onChange(index, "qty", value)} onUomCodeChange={(value) => onChange(index, "uomCode", value)} quantityLabel={`${t("create.parts.quantity")} ${index + 1}`} unitLabel={`${t("create.parts.unit")} ${index + 1}`} locale={locale} compact />
            <input {...textEntryProps("identifier")} value={part.repairOrder} onChange={(event) => onChange(index, "repairOrder", event.target.value)} aria-label={`${t("create.parts.repairOrder")} ${index + 1}`} placeholder={t("create.parts.repairOrder")} />
            <button type="button" onClick={() => onRemove(index)} disabled={parts.length <= 1}>{t("create.parts.remove")}</button>
          </div>
        ))}
      </div>
      <div className="create-parts-actions">
        <Button type="button" className="create-parts-compact-action" variant="secondary" icon={Plus} onClick={() => onAdd()} disabled={parts.length >= 18}>
          {t("create.parts.add")}
        </Button>
        <CreatePartScanner
          disabled={!canAddPart}
          locationId={locationId}
          locale={locale}
          onScanned={(unit) => onAdd({
            catalogPartId: unit.catalogPartId,
            partNo: unit.partNumber,
            qty: "1",
            uomCode: unit.uomCode,
            repairOrder: "",
          })}
        />
        <p className="create-parts-action-help">{t("create.parts.scanDraftHelp")}</p>
      </div>
    </div>
  );
}

export function CreatePartsModule({
  access,
  activeSection,
  errors,
  laborHours = "",
  laborProduct = null,
  laborRepairOrder = "",
  locationId,
  locale = "en",
  parts = [],
  onAdd,
  onChange,
  onLaborHoursChange,
  onLaborRepairOrderChange,
  onRemove,
}) {
  const compactLayout = useMediaQuery(COMPACT_PARTS_QUERY);
  const rootRef = useRef(null);
  const summaryRefs = useRef({});
  const pendingReturnFocusRef = useRef(null);
  const [editingPartIndex, setEditingPartIndex] = useState(-1);
  const [laborOpen, setLaborOpen] = useState(false);

  const t = (key) => interfaceText(locale, key);
  const configuredLaborLabel = laborProductLabel(laborProduct);
  const laborLabel = configuredLaborLabel === "Labor hours" && !laborProduct?.code
    ? t("create.parts.laborHours")
    : configuredLaborLabel;
  const filledIndexes = filledCreatePartIndexes(parts);
  const firstBlankIndex = firstBlankCreatePartIndex(parts);
  const renderIndexes = createPartRenderIndexes(parts, editingPartIndex);
  const hasLabor = Boolean(String(laborHours || "").trim() || String(laborRepairOrder || "").trim());
  const canAddPart = parts.length < 18 || firstBlankIndex >= 0;

  useEffect(() => {
    if (!compactLayout || !errors?.parts) return;
    const invalidIndex = invalidCreatePartIndex(parts);
    if (invalidIndex >= 0) {
      setLaborOpen(false);
      setEditingPartIndex(invalidIndex);
    }
  }, [compactLayout, errors?.parts, parts]);

  useEffect(() => {
    if (!compactLayout || editingPartIndex < 0 || editingPartIndex >= parts.length) return undefined;
    const frame = window.requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector(`[data-part-editor-index="${editingPartIndex}"] .part-catalog-field input`)
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [compactLayout, editingPartIndex, parts.length]);

  useEffect(() => {
    if (editingPartIndex >= 0 || pendingReturnFocusRef.current === null) return;
    const targetIndex = pendingReturnFocusRef.current;
    pendingReturnFocusRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      const addButton = rootRef.current?.querySelector(".create-parts-add-button");
      if (targetIndex === "add") addButton?.focus();
      else (summaryRefs.current[targetIndex] || addButton)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingPartIndex, parts]);

  function startAddingPart() {
    const targetIndex = firstBlankIndex >= 0 ? firstBlankIndex : parts.length;
    if (targetIndex >= 18) return;
    if (firstBlankIndex < 0) onAdd();
    setLaborOpen(false);
    setEditingPartIndex(targetIndex);
  }

  function finishEditingPart(index) {
    pendingReturnFocusRef.current = createPartHasContent(parts[index]) ? index : "add";
    setEditingPartIndex(-1);
  }

  function removePart(index) {
    if (parts.length <= 1) {
      onChange(index, {
        catalogPartId: null,
        partNo: "",
        qty: "",
        repairOrder: "",
      });
    } else {
      onRemove(index);
    }
    pendingReturnFocusRef.current = "add";
    setEditingPartIndex(-1);
  }

  function addScannedPart(unit) {
    const targetIndex = firstBlankIndex >= 0 ? firstBlankIndex : parts.length;
    onAdd({
      catalogPartId: unit.catalogPartId,
      partNo: unit.partNumber,
      qty: "1",
      uomCode: unit.uomCode,
      repairOrder: "",
    });
    setLaborOpen(false);
    setEditingPartIndex(targetIndex);
  }

  function renderCompactPart(part, index, ordinal) {
    if (editingPartIndex !== index) {
      const quantity = String(part.qty || "").trim()
        ? formatQuantityUnit(part.qty, part.uomCode)
        : t("create.parts.quantityMissing");
      return (
        <button
          className="create-part-summary"
          key={index}
          type="button"
          onClick={() => {
            setLaborOpen(false);
            setEditingPartIndex(index);
          }}
          ref={(element) => { summaryRefs.current[index] = element; }}
          aria-label={`${t("create.parts.edit")} ${part.partNo || `${t("create.parts.part")} ${ordinal}`}`}
        >
          <span className="create-part-summary-main">
            <strong>{part.partNo || `${t("create.parts.part")} ${ordinal}`}</strong>
            <small>{quantity}</small>
          </span>
          <span className={`create-part-summary-repair ${part.repairOrder ? "" : "is-missing"}`.trim()}>
            {part.repairOrder || t("create.parts.repairOrderMissing")}
          </span>
          <span className="create-part-summary-edit">{t("create.parts.edit")}</span>
        </button>
      );
    }

    return (
      <article className="create-part-editor operational-part-row" data-part-editor-index={index} key={index}>
        <header className="create-part-editor-header">
          <div>
            <span>{t("create.parts.approvedPart")}</span>
            <strong>{t("create.parts.part")} {ordinal}</strong>
          </div>
        </header>
        <div className="create-part-editor-fields">
          <PartCatalogCombobox
            locationId={locationId}
            purpose="issue"
            value={part.partNo}
            onChange={(value) => onChange(index, {
              catalogPartId: null,
              partNo: value,
              qty: usedPartQuantityAfterPartNumberChange(part, value),
            })}
            onSelect={(catalogPart) => onChange(index, {
              catalogPartId: catalogPart.id,
              partNo: catalogPart.partNumber,
              qty: defaultUsedPartQuantity(part.qty),
              uomCode: catalogPart.uomCode || part.uomCode,
              repairOrder: repairOrderAfterCatalogSelection(part.repairOrder, catalogPart),
            })}
            label={t("create.parts.numberOrDescription")}
            inputAriaLabel={`${t("create.parts.partNumber")} ${ordinal}`}
            placeholder={t("create.parts.numberOrDescription")}
            inputPolicy="identifier"
            locale={locale}
          />
          <QuantityUnitInput
            id={`known-part-quantity-${index}`}
            quantity={part.qty}
            uomCode={part.uomCode}
            onQuantityChange={(value) => onChange(index, "qty", value)}
            onUomCodeChange={(value) => onChange(index, "uomCode", value)}
            quantityLabel={t("create.parts.quantity")}
            unitLabel={t("create.parts.unit")}
            locale={locale}
          />
          <label className="create-part-repair-field">
            <span>{t("create.parts.repairOrder")}</span>
            <input
              {...textEntryProps("identifier")}
              value={part.repairOrder}
              onChange={(event) => onChange(index, "repairOrder", event.target.value)}
              aria-label={`${t("create.parts.repairOrder")} ${ordinal}`}
              placeholder={t("create.parts.repairOrder")}
            />
          </label>
        </div>
        <footer className="create-part-editor-actions">
          <Button type="button" variant="primary" onClick={() => finishEditingPart(index)}>{t("common.done")}</Button>
          {createPartHasContent(part) ? (
            <button className="create-part-remove" type="button" onClick={() => removePart(index)}>{t("create.parts.remove")}</button>
          ) : null}
        </footer>
      </article>
    );
  }

  if (!access) return null;

  return (
    <ProgressiveWorkorderSection id="parts" className="create-parts-card" title={t("create.parts.title")} summary={t("create.parts.summary")} activeSection={activeSection} onSelect={() => {}} displayMode="panel" keepMounted>
      {compactLayout ? (
        <div className="create-known-parts-content create-parts-compact" id="create-known-parts-editor" ref={rootRef} tabIndex={-1}>
          {errors?.parts ? <p className="operational-form-field-error" role="alert">{errors.parts}</p> : null}

          <section className="create-parts-group" aria-labelledby="create-parts-labor-title">
            <div className="create-parts-group-heading">
              <div>
                <h3 id="create-parts-labor-title">{t("create.parts.laborAndWork")}</h3>
                <p>{t("create.parts.laborHelp")}</p>
              </div>
            </div>
            {laborOpen ? (
              <div className="create-labor-editor">
                <div className="create-labor-editor-header">
                  <strong>{laborLabel}</strong>
                  <button type="button" onClick={() => setLaborOpen(false)}>{t("common.done")}</button>
                </div>
                <div className="create-labor-editor-fields">
                  <QuantityUnitInput
                    id="create-workorder-labor-hours"
                    quantity={laborHours}
                    uomCode="hr"
                    onValueChange={({ quantity }) => onLaborHoursChange(quantity)}
                    quantityLabel={t("create.parts.laborHours")}
                    unitLabel={t("create.parts.unit")}
                    locale={locale}
                    unitReadOnly
                    max={9999}
                  />
                  <label className="create-part-repair-field">
                    <span>{t("create.parts.repairWork")}</span>
                    <input
                      {...textEntryProps("narrative")}
                      value={laborRepairOrder}
                      onChange={(event) => onLaborRepairOrderChange(event.target.value)}
                      aria-label={t("create.parts.repairWork")}
                      placeholder={t("create.parts.repairWork")}
                    />
                  </label>
                </div>
              </div>
            ) : (
              <button
                className="create-labor-summary"
                type="button"
                aria-expanded={false}
                onClick={() => {
                  setEditingPartIndex(-1);
                  setLaborOpen(true);
                }}
              >
                <span>
                  <strong>{laborLabel}</strong>
                  <small>{hasLabor
                    ? [laborHours ? `${laborHours} hr` : "", laborRepairOrder].filter(Boolean).join(" · ")
                    : t("create.parts.notEntered")}</small>
                </span>
                <span>{t(hasLabor ? "create.parts.edit" : "create.parts.addLabor")}</span>
              </button>
            )}
          </section>

          <section className="create-parts-group" aria-labelledby="create-parts-approved-title">
            <div className="create-parts-group-heading">
              <div>
                <h3 id="create-parts-approved-title">{t("create.parts.approvedParts")}</h3>
                <p>{t("create.parts.approvedPartsHelp")}</p>
              </div>
              <span className="create-parts-count" aria-label={`${filledIndexes.length} ${t("create.parts.approvedParts")}`}>{filledIndexes.length}</span>
            </div>

            {!renderIndexes.length ? (
              <div className="create-parts-empty">
                <strong>{t("create.parts.noParts")}</strong>
                <p>{t("create.parts.noPartsHelp")}</p>
              </div>
            ) : (
              <div className="create-parts-list">
                {renderIndexes.map((index, position) => renderCompactPart(parts[index], index, position + 1))}
              </div>
            )}

            <div className="create-parts-actions">
              <Button type="button" className="create-parts-compact-action create-parts-add-button" variant="primary" icon={Plus} onClick={startAddingPart} disabled={!canAddPart}>
                {filledIndexes.length ? t("create.parts.addAnother") : t("create.parts.add")}
              </Button>
              <CreatePartScanner disabled={!canAddPart} locationId={locationId} locale={locale} onScanned={addScannedPart} />
              <details className="create-parts-scan-help">
                <summary>{t("create.parts.scanHelpTitle")}</summary>
                <p>{t("create.parts.scanDraftHelp")}</p>
              </details>
            </div>
          </section>
        </div>
      ) : (
        <LegacyCreatePartsEditor
          canAddPart={canAddPart}
          errors={errors}
          laborHours={laborHours}
          laborLabel={laborLabel}
          laborRepairOrder={laborRepairOrder}
          locale={locale}
          locationId={locationId}
          onAdd={onAdd}
          onChange={onChange}
          onLaborHoursChange={onLaborHoursChange}
          onLaborRepairOrderChange={onLaborRepairOrderChange}
          onRemove={onRemove}
          parts={parts}
          t={t}
        />
      )}
    </ProgressiveWorkorderSection>
  );
}
