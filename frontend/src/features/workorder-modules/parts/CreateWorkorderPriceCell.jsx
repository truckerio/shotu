import { useState } from "react";
import { PriceSourceDropdown } from "../../../components/workorders/PriceSourceDropdown.jsx";
import { PartRatesDialog } from "../../../components/pricing/PartRatesDialog.jsx";
import { LaborRatesDialog } from "../../../components/workorders/LaborRatesDialog.jsx";

function currencyPrefix(price) {
  return !price?.currency || price.currency === "USD" ? "$" : price.currency;
}

function validCustomPrice(value) {
  return /^(?:\d{1,10})(?:\.\d{1,4})?$/.test(String(value || ""));
}

function inputPriceValue(customUnitPrice, selectedPrice) {
  if (customUnitPrice !== "") return customUnitPrice;
  const numeric = Number(selectedPrice?.unitPrice);
  return selectedPrice && Number.isFinite(numeric) ? numeric.toFixed(2) : "";
}

function InlinePriceControl({ customUnitPrice = "", onCustomUnitPriceChange, onSelectionChange, selectedPrice, selection, options, includeBatch, onSetRates }) {
  return <>
    <div className="create-inline-price-control">
      <span aria-hidden="true">{currencyPrefix(selectedPrice)}</span>
      <input aria-label="Workorder unit price" disabled={!selectedPrice} inputMode="decimal" min="0" placeholder="Price" step="0.0001" type="number"
        value={inputPriceValue(customUnitPrice, selectedPrice)} onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => onCustomUnitPriceChange?.(event.target.value)} />
      <PriceSourceDropdown className="create-price-source-menu" popoverClassName="create-price-source-popover workorder-price-source-popover"
        value={selection} options={options} includeBatch={includeBatch} onChange={(event) => onSelectionChange(event.target.value)} onSetRates={onSetRates} />
    </div>
    {customUnitPrice && !validCustomPrice(customUnitPrice) ? <small role="alert">Enter a price with up to four decimal places.</small> : null}
  </>;
}

export function CreatePartPriceCell({
  customUnitPrice = "", eligible = false, selection = "", trackingMode, preview, previewStatus, onChange, onCustomUnitPriceChange,
  catalogPartId, partLabel, locationId, uomCode, onRatesSaved,
}) {
  const [ratesOpen, setRatesOpen] = useState(false);
  if (!eligible && !catalogPartId) return <div className="create-workorder-price-cell create-price-unavailable">
    <input aria-label="Price" className="create-price-empty-field" disabled placeholder="Price" value="" />
  </div>;
  const stale = previewStatus !== "ready";
  const options = eligible && !stale ? preview?.options || {} : {};
  const selectedPrice = preview?.status === "known" ? preview.price : null;
  return <div className="create-workorder-price-cell">
    <InlinePriceControl customUnitPrice={customUnitPrice} options={options} includeBatch={trackingMode !== "no_stock"}
      onCustomUnitPriceChange={onCustomUnitPriceChange} onSelectionChange={onChange} selectedPrice={selectedPrice} selection={selection}
      onSetRates={catalogPartId && locationId ? () => setRatesOpen(true) : undefined} />
    {ratesOpen ? <PartRatesDialog open onClose={() => setRatesOpen(false)} catalogPartId={catalogPartId} partLabel={partLabel} locationId={locationId} uomCode={uomCode} onSaved={onRatesSaved} /> : null}
    {selection && stale ? <small role="status">Updating price…</small> : null}
    {selection && previewStatus === "ready" && preview?.status !== "known" ? <small role="alert">{preview?.reason || "Price unavailable. Choose another source or set rates."}</small> : null}
  </div>;
}

export function CreateLaborPriceCell({
  customUnitPrice = "", selection = "", preview, previewStatus, onChange, onCustomUnitPriceChange,
  productId, locationId, uomCode = "hr", laborLabel, onRatesSaved,
}) {
  const [ratesOpen, setRatesOpen] = useState(false);
  const currentRates = preview?.currentRates || {};
  const stale = previewStatus !== "ready";
  const options = Object.fromEntries(["internal_cost", "selling_price"].map((kind) => [kind, {
    status: stale ? "incomplete" : currentRates[kind]?.status,
    price: { unitPrice: currentRates[kind]?.amount, currency: currentRates[kind]?.currency },
  }]));
  const selectedPrice = preview?.status === "known" ? preview.price : null;
  return <div className="create-workorder-price-cell create-labor-price-cell">
    <InlinePriceControl customUnitPrice={customUnitPrice} options={options} includeBatch={false}
      onCustomUnitPriceChange={onCustomUnitPriceChange} onSelectionChange={onChange} selectedPrice={selectedPrice} selection={selection}
      onSetRates={productId && locationId ? () => setRatesOpen(true) : undefined} />
    {ratesOpen ? <LaborRatesDialog open onClose={() => setRatesOpen(false)} productId={productId} locationId={locationId} uomCode={uomCode}
      subjectLabel={laborLabel} rates={currentRates} onSaved={onRatesSaved} /> : null}
    {selection && stale ? <small role="status">Updating price…</small> : null}
    {selection && previewStatus === "ready" && preview?.status !== "known" ? <small role="alert">{preview?.reason || "Labor rate unavailable. Set the selected local rate first."}</small> : null}
  </div>;
}
