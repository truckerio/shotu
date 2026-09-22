import { Dropdown } from "./Dropdown.jsx";

const common = ["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "MXN", "INR", "JPY", "CNY"];
const currencies = [...new Set([...common, ...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : [])])];

export function CurrencySelector({ value = "", ...props }) {
  const current = String(value || "").toUpperCase();
  const options = current && !currencies.includes(current) ? [...currencies, current] : currencies;
  return <Dropdown aria-label="Currency" {...props} value={current}>
    <option value="">Choose currency</option>
    {options.map(code => <option key={code} value={code}>{code}</option>)}
  </Dropdown>;
}
