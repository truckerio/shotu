import { Dropdown } from "../forms/Dropdown.jsx";
import { formatLocaleNumber } from "../../i18n/index.js";
import "./workorder-queue-filter.css";

export function WorkorderQueueFilter({ options, value, onChange, locale = "en", label = "Queue" }) {
  return <label className="workorder-queue-filter">
    <span>{label}</span>
    <Dropdown aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.key} value={option.key}>{option.label}{option.count == null ? "" : ` (${typeof option.count === "number" ? formatLocaleNumber(option.count, locale) : option.count})`}</option>)}
    </Dropdown>
  </label>;
}
