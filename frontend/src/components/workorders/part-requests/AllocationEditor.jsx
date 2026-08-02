import { Plus, Trash01 } from "@untitledui/icons";
import { AnchoredSelect } from "../../forms/AnchoredSelect.jsx";
import { QuantityUnitInput } from "../../forms/QuantityUnitInput.jsx";
import { textEntryProps } from "../../forms/text-entry-policy.js";
import { ALLOCATION_STATUS_LABELS, SOURCE_OPTIONS } from "./part-request-model.js";

export function AllocationEditor({ allocations, setAllocations, quantity, uomCode, inventory }) {
  function update(index, field, value) {
    setAllocations((current) => current.map((allocation, allocationIndex) => (
      allocationIndex === index ? { ...allocation, [field]: value } : allocation
    )));
  }

  function add() {
    setAllocations((current) => [...current, {
      sourceType: "unknown",
      status: "proposed",
      quantity: 1,
      uomCode,
      vendor: "",
    }]);
  }

  function remove(index) {
    setAllocations((current) => current.length <= 1
      ? current
      : current.filter((_, allocationIndex) => allocationIndex !== index));
  }

  function updateSource(index, sourceType) {
    update(index, "sourceType", sourceType);
    update(index, "status", sourceType === "inventory" ? "reserved" : "proposed");
    if (sourceType === "inventory" && inventory[0]) {
      update(index, "inventoryItemId", inventory[0].id);
      update(index, "locationId", inventory[0].locationId);
    }
  }

  return (
    <div className="allocation-editor">
      <div className="allocation-editor-head">
        <strong>Supply</strong>
        <button type="button" onClick={add} title="Split supply source" aria-label="Add supply source"><Plus /></button>
      </div>
      {allocations.map((allocation, index) => (
        <div className="allocation-row" key={index}>
          <AnchoredSelect
            label={`Supply source ${index + 1}`}
            labelHidden
            value={allocation.sourceType}
            onChange={(sourceType) => updateSource(index, sourceType)}
            options={SOURCE_OPTIONS}
            className="allocation-source-select"
          />
          <QuantityUnitInput
            id={`allocation-quantity-${index}`}
            quantity={allocation.quantity}
            uomCode={allocation.uomCode || uomCode}
            onQuantityChange={(value) => update(index, "quantity", value)}
            onUomCodeChange={() => {}}
            quantityLabel={`Supply quantity ${index + 1}`}
            unitLabel={`Supply unit ${index + 1}`}
            max={quantity}
            unitReadOnly
            compact
          />
          {allocation.sourceType === "purchase" ? (
            <input {...textEntryProps("name")} value={allocation.vendor || ""} onChange={(event) => update(index, "vendor", event.target.value)} placeholder="Vendor optional" aria-label={`Vendor ${index + 1}`} />
          ) : <span className="allocation-source-status">{ALLOCATION_STATUS_LABELS[allocation.status]}</span>}
          <button type="button" onClick={() => remove(index)} disabled={allocations.length <= 1} title="Remove supply source" aria-label="Remove supply source"><Trash01 /></button>
        </div>
      ))}
    </div>
  );
}
