import { FormField } from "./FormField.jsx";
import { textEntryProps } from "./text-entry-policy.js";
import "./operational-form.css";

export function CustomerCompanyField({
  error = "",
  hint = "Company that owns or operates this unit.",
  id = "customer-company-name",
  label = "Customer company",
  onChange,
  required = false,
  value,
  ...inputProps
}) {
  return (
    <FormField id={id} label={label} hint={hint} error={error} required={required}>
      <input
        {...textEntryProps("name")}
        {...inputProps}
        type="text"
        value={value}
        onChange={(event) => onChange?.(event.target.value, event)}
        autoComplete="organization"
      />
    </FormField>
  );
}
