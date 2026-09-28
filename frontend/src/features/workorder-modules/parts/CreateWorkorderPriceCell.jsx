import { Dropdown } from "../../../components/forms/Dropdown.jsx";
import { formatWorkorderMoney } from "../../../components/workorders/workorder-pricing-model.js";

function optionPrice(option) {
  return option?.status === "known" ? option.price : null;
}

function priceOptionLabel(price, label) {
  const amount = formatWorkorderMoney(price?.unitPrice, price?.currency);
  return amount ? `${amount} ${label}` : `${label[0].toUpperCase()}${label.slice(1)} unavailable`;
}

function currencyPrefix(price) {
  if (!price?.currency || price.currency === "USD") return "$";
  return price.currency;
}

function validCustomPrice(value) {
  return /^(?:\d{1,10})(?:\.\d{1,4})?$/.test(String(value || ""));
}

function inputPriceValue(customUnitPrice, selectedPrice) {
  if (customUnitPrice !== "") return customUnitPrice;
  const numeric = Number(selectedPrice?.unitPrice);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "";
}

function InlinePriceControl({
  customUnitPrice = "",
  internalPrice,
  internalValue,
  onCustomUnitPriceChange,
  onSelectionChange,
  selectedPrice,
  selection,
  sellingPrice,
}) {
  return <>
    <div className="create-inline-price-control">
      <span aria-hidden="true">{currencyPrefix(selectedPrice)}</span>
      <input
        aria-label="Workorder unit price"
        disabled={!selectedPrice}
        inputMode="decimal"
        min="0"
        placeholder="Price"
        step="0.0001"
        type="number"
        value={inputPriceValue(customUnitPrice, selectedPrice)}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => onCustomUnitPriceChange?.(event.target.value)}
      />
      <Dropdown
        aria-label="Price source"
        className="create-price-source-menu"
        value={selection}
        onChange={(event) => onSelectionChange(event.target.value)}
      >
        <option value="">Select price</option>
        <option value={internalValue} disabled={!internalPrice}>{priceOptionLabel(internalPrice, "internal price")}</option>
        <option value="selling_price" disabled={!sellingPrice}>{priceOptionLabel(sellingPrice, "selling price")}</option>
      </Dropdown>
    </div>
    {customUnitPrice && !validCustomPrice(customUnitPrice) ? <small role="alert">Enter a price with up to four decimal places.</small> : null}
  </>;
}

export function CreatePartPriceCell({
  customUnitPrice = "",
  eligible = false,
  selection = "",
  preview,
  previewStatus,
  onChange,
  onCustomUnitPriceChange,
}) {
  if (!eligible) return <div className="create-workorder-price-cell create-price-unavailable">
    <input aria-label="Price" className="create-price-empty-field" disabled placeholder="Price" value="" />
  </div>;
  const price = preview?.status === "known" ? { ...preview.price, selection: preview.price?.selection || selection } : null;
  const stale = previewStatus !== "ready";
  const internalPrice = optionPrice(preview?.options?.batch_cost)
    || (price?.selection === "batch_cost" ? price : null);
  const sellingPrice = optionPrice(preview?.options?.selling_price)
    || (price?.selection === "selling_price" ? price : null);
  const selectedPrice = selection === "batch_cost" ? internalPrice : selection === "selling_price" ? sellingPrice : null;
  return <div className="create-workorder-price-cell">
    <InlinePriceControl
      customUnitPrice={customUnitPrice}
      internalPrice={internalPrice}
      internalValue="batch_cost"
      onCustomUnitPriceChange={onCustomUnitPriceChange}
      onSelectionChange={onChange}
      selectedPrice={selectedPrice}
      selection={selection}
      sellingPrice={sellingPrice}
    />
    {selection && stale ? <small role="status">Updating price…</small> : null}
    {selection && previewStatus === "ready" && preview?.status !== "known" ? <small role="alert">{preview?.reason || "Price unavailable. Choose another source or update inventory pricing."}</small> : null}
  </div>;
}

export function CreateLaborPriceCell({
  customUnitPrice = "",
  selection = "",
  preview,
  previewStatus,
  onChange,
  onCustomUnitPriceChange,
}) {
  const currentRates = preview?.currentRates || {};
  const price = preview?.status === "known" ? { ...preview.price, selection: preview.price?.selection || selection } : null;
  const stale = previewStatus !== "ready";
  const internalPrice = currentRates.internal_cost?.status === "known"
    ? { unitPrice: currentRates.internal_cost.amount, currency: currentRates.internal_cost.currency }
    : null;
  const sellingPrice = currentRates.selling_price?.status === "known"
    ? { unitPrice: currentRates.selling_price.amount, currency: currentRates.selling_price.currency }
    : null;
  const selectedPrice = selection === "internal_cost" ? internalPrice : selection === "selling_price" ? sellingPrice : null;
  return <div className="create-workorder-price-cell create-labor-price-cell">
    <InlinePriceControl
      customUnitPrice={customUnitPrice}
      internalPrice={internalPrice}
      internalValue="internal_cost"
      onCustomUnitPriceChange={onCustomUnitPriceChange}
      onSelectionChange={onChange}
      selectedPrice={selectedPrice}
      selection={selection}
      sellingPrice={sellingPrice}
    />
    {selection && stale ? <small role="status">Updating price…</small> : null}
    {selection && previewStatus === "ready" && preview?.status !== "known" ? <small role="alert">{preview?.reason || "Labor rate unavailable. Configure the selected local rate first."}</small> : null}
  </div>;
}
