import { QuantityUnitInput } from "../../../components/forms/index.js";
import { textEntryProps } from "../../../components/forms/text-entry-policy.js";
import { PartCatalogCombobox } from "../../../components/workorders/part-requests/PartCatalogCombobox.jsx";
import {
  defaultUsedPartQuantity,
  usedPartQuantityAfterPartNumberChange,
} from "../../../components/workorders/used-parts-model.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { Button } from "../../../components/ui/Button.jsx";

export function CreatePartsModule({
  access,
  activeSection,
  errors,
  laborHours = "",
  laborRepairOrder = "",
  locationId,
  parts,
  onAdd,
  onChange,
  onLaborHoursChange,
  onRemove,
}) {
  if (!access) return null;
  return (
    <ProgressiveWorkorderSection id="parts" className="create-parts-card" title="Parts" summary="Optional. Record parts already known before work begins." activeSection={activeSection} onSelect={() => {}} displayMode="panel" keepMounted>
      <div className="create-known-parts-content">
        {errors?.parts ? <p className="operational-form-field-error" role="alert">{errors.parts}</p> : null}
        <div className="operational-parts-editor">
          <div className="operational-part-row has-quantity-unit operational-part-labor-row">
            <strong>1</strong>
            <div className="operational-part-labor-name">
              <span>Labor</span>
              <strong>[PTR001] LABOR HOURS</strong>
            </div>
            <QuantityUnitInput
              id="create-workorder-labor-hours"
              quantity={laborHours}
              uomCode="hr"
              onValueChange={({ quantity }) => onLaborHoursChange(quantity)}
              quantityLabel="Labor hours"
              unitLabel="Unit"
              unitReadOnly
              compact
              max={9999}
            />
            <span className="operational-part-labor-repair">{laborRepairOrder || "Add in Diagnosis and repair"}</span>
            <span aria-hidden="true"></span>
          </div>
          {parts.map((part, index) => (
          <div className="operational-part-row has-quantity-unit" key={index}>
            <strong>{index + 2}</strong>
            <PartCatalogCombobox
              locationId={locationId}
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
              })}
              label="Part number"
              inputAriaLabel={`Part number ${index + 1}`}
              placeholder="Part number or description"
              inputPolicy="identifier"
            />
            <QuantityUnitInput id={`known-part-quantity-${index}`} quantity={part.qty} uomCode={part.uomCode} onQuantityChange={(value) => onChange(index, "qty", value)} onUomCodeChange={(value) => onChange(index, "uomCode", value)} quantityLabel={`Quantity ${index + 1}`} unitLabel={`Unit ${index + 1}`} compact />
            <input {...textEntryProps("identifier")} value={part.repairOrder} onChange={(event) => onChange(index, "repairOrder", event.target.value)} aria-label={`Repair order ${index + 1}`} placeholder="Repair order" />
            <button type="button" onClick={() => onRemove(index)} disabled={parts.length <= 1}>Remove</button>
          </div>
          ))}
        </div>
        <Button type="button" variant="secondary" onClick={onAdd}>Add part</Button>
      </div>
    </ProgressiveWorkorderSection>
  );
}
