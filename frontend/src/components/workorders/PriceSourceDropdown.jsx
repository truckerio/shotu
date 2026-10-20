import { Dropdown } from "../forms/Dropdown.jsx";
import { formatWorkorderMoney } from "./workorder-pricing-model.js";

export function PriceSourceDropdown({
  "aria-label": ariaLabel = "Price source",
  className,
  popoverClassName = "workorder-price-source-popover",
  placement = "bottom end",
  value = "",
  options = {},
  includeBatch = true,
  disabled = false,
  onChange,
  onSetRates,
}) {
  const kinds = [
    ...(includeBatch ? [["batch_cost", "Batch cost"]] : []),
    ["internal_cost", "Internal price"],
    ["selling_price", "Selling price"],
  ];
  return <Dropdown aria-label={ariaLabel} className={className} popoverClassName={popoverClassName} placement={placement}
    showSelectionIndicator={false} value={value} disabled={disabled}
    onChange={(event) => event.target.value === "set_rates" ? onSetRates?.() : onChange?.(event)}>
    <option value="">Select price</option>
    {kinds.map(([kind, label]) => {
      const option = options[kind];
      const amount = option?.status === "known" ? formatWorkorderMoney(option.price?.unitPrice, option.price?.currency) : null;
      return <option key={kind} value={kind} data-description={amount || (kind === "batch_cost" ? "Cost not recorded" : "Not configured")} disabled={!amount}>{label}</option>;
    })}
    {onSetRates ? <option value="set_rates">Set rates…</option> : null}
  </Dropdown>;
}
