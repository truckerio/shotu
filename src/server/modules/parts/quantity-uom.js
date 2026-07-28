import { z } from "zod";
import {
  DEFAULT_UOM_CODE,
  MAX_QUANTITY,
  UNITS_OF_MEASURE,
  formatQuantity,
  getUnitDefinition,
  normalizeUomCode,
} from "../../../../shared/units-of-measure.js";

const UOM_CODES = UNITS_OF_MEASURE.map((unit) => unit.code);

export const uomCodeSchema = z.enum(UOM_CODES).default(DEFAULT_UOM_CODE);
export const quantitySchema = z.coerce.number().positive().max(MAX_QUANTITY);

export function validateQuantityUnit(value, context, quantityPath = ["quantity"]) {
  const definition = getUnitDefinition(value.uomCode);
  const quantity = value[quantityPath.at(-1)];
  if (!definition) {
    context.addIssue({
      code: "custom",
      path: ["uomCode"],
      message: "Select a valid unit.",
    });
    return;
  }
  if (definition.decimalScale === 0 && !Number.isInteger(quantity)) {
    context.addIssue({
      code: "custom",
      path: quantityPath,
      message: `${definition.label} quantities must be whole numbers.`,
    });
    return;
  }
  const scaled = quantity * 1000;
  if (Math.abs(scaled - Math.round(scaled)) > Number.EPSILON * Math.abs(scaled || 1) * 4) {
    context.addIssue({
      code: "custom",
      path: quantityPath,
      message: "Quantity can have at most three decimal places.",
    });
  }
}

export function numericValue(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function publicQuantity(value) {
  return numericValue(value);
}

export function quantityLabel(quantity, uomCode = DEFAULT_UOM_CODE) {
  return formatQuantity(quantity, normalizeUomCode(uomCode));
}
