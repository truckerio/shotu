import { Plus } from "@untitledui/icons";
import { QuantityUnitInput } from "../../../components/forms/index.js";
import { textEntryProps } from "../../../components/forms/text-entry-policy.js";
import { PartCatalogCombobox } from "../../../components/workorders/part-requests/PartCatalogCombobox.jsx";
import { repairOrderAfterCatalogSelection } from "../../../components/workorders/part-requests/catalog-parts-model.js";
import {
  defaultUsedPartQuantity,
  usedPartQuantityAfterPartNumberChange,
} from "../../../components/workorders/used-parts-model.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { laborProductLabel } from "../../../../../shared/labor-product.js";
import { interfaceText } from "../../../i18n/index.js";
import { CreatePartScanner } from "./CreatePartScanner.jsx";
import "./create-parts-module.css";

export function CreatePartsModule({
  access,
  activeSection,
  errors,
  laborHours = "",
  laborProduct = null,
  laborRepairOrder = "",
  locationId,
  locale = "en",
  parts,
  onAdd,
  onChange,
  onLaborHoursChange,
  onLaborRepairOrderChange,
  onRemove,
}) {
  if (!access) return null;
  const t = (key) => interfaceText(locale, key);
  const configuredLaborLabel = laborProductLabel(laborProduct);
  const laborLabel = configuredLaborLabel === "Labor hours" && !laborProduct?.code
    ? t("create.parts.laborHours")
    : configuredLaborLabel;
  const canAddPart = parts.length < 18 || parts.some((part) => !part.partNo && !part.qty && !part.repairOrder);
  return (
    <ProgressiveWorkorderSection id="parts" className="create-parts-card" title={t("create.parts.title")} summary={t("create.parts.summary")} activeSection={activeSection} onSelect={() => {}} displayMode="panel" keepMounted>
      <div className="create-known-parts-content">
        {errors?.parts ? <p className="operational-form-field-error" role="alert">{errors.parts}</p> : null}
        <div className="operational-parts-editor">
          <div className="operational-part-row has-quantity-unit operational-part-labor-row">
            <strong>1</strong>
            <div className="operational-part-labor-name">
              <strong>{laborLabel}</strong>
            </div>
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
    </ProgressiveWorkorderSection>
  );
}
