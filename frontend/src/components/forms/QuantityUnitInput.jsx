import { useId } from "react";
import {
  quantityInputModel,
  normalizeQuantityInput,
} from "./quantity-unit-model.js";
import { UnitOfMeasurePicker } from "./UnitOfMeasurePicker.jsx";
import { interfaceText } from "../../i18n/index.js";
import "./quantity-unit-input.css";

export function QuantityUnitInput({
  quantity,
  uomCode,
  onQuantityChange,
  onUomCodeChange,
  onValueChange,
  quantityLabel = "Quantity",
  unitLabel = "Unit",
  disabled = false,
  quantityReadOnly = false,
  unitReadOnly = false,
  compact = false,
  max,
  id,
  locale = "en",
}) {
  const t = (key) => interfaceText(locale, key);
  const generatedId = useId();
  const inputId = id || `quantity-${generatedId}`;
  const model = quantityInputModel(quantity, uomCode);

  function commitQuantity() {
    if (model.quantity === "") return;
    const normalized = normalizeQuantityInput(model.quantity, model.code);
    if (normalized && normalized !== model.quantity) {
      if (onValueChange) onValueChange({ quantity: normalized, uomCode: model.code });
      else onQuantityChange(normalized);
    }
  }

  function selectUnit(nextCode) {
    if (onValueChange) onValueChange({ quantity: model.quantity, uomCode: nextCode });
    else onUomCodeChange(nextCode);
  }

  return (
    <div
      className={`quantity-unit-input ${compact ? "is-compact" : ""}`}
    >
      <label className="quantity-unit-number" htmlFor={inputId}>
        <span>{quantityLabel}</span>
        <input
          id={inputId}
          type="number"
          min={model.step}
          max={max}
          step={model.step}
          inputMode={model.decimalScale ? "decimal" : "numeric"}
          value={model.quantity}
          onChange={(event) => {
            const value = event.target.value;
            if (onValueChange) onValueChange({ quantity: value, uomCode: model.code });
            else onQuantityChange(value);
          }}
          onBlur={commitQuantity}
          placeholder={t("uom.quantityShort")}
          aria-label={quantityLabel}
          disabled={disabled}
          readOnly={quantityReadOnly}
          aria-readonly={quantityReadOnly || undefined}
        />
      </label>
      <div className="quantity-unit-picker"><span>{unitLabel}</span><UnitOfMeasurePicker id={`${inputId}-unit`} uomCode={model.code} onChange={selectUnit} label={unitLabel} disabled={disabled} readOnly={unitReadOnly} locale={locale} /></div>
    </div>
  );
}
