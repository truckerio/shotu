import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { discountDisplay } from "./discount-display.js";
import "./customer-document-discount-editor.css";

function noDiscount() {
  return { lineDiscounts: [], documentDiscount: null, overrideReasons: [] };
}

export function CustomerDocumentDiscountEditor({ adjustments, onChange, disabled = false, inline = false, maximumOfficePercentage = null, projection = null }) {
  const discount = adjustments?.documentDiscount || null;
  const update = (next) => onChange?.({ ...noDiscount(), documentDiscount: next });
  const active = Boolean(discount);
  const discountSummary = discountDisplay(discount, projection);
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    if (disabled) setDetailsOpen(false);
  }, [disabled]);
  const percentageHint = maximumOfficePercentage !== null && maximumOfficePercentage !== undefined
    ? `Office discounts are limited to ${maximumOfficePercentage}%.`
    : "";
  const detailFields = active ? <>
    <label>{discount.kind === "percentage" ? "Percent" : "Amount"}
      <input autoFocus={inline} inputMode="decimal" min="0" max={discount.kind === "percentage" ? "100" : undefined} placeholder={discount.kind === "percentage" ? "0" : "0.00"} value={discount.value ?? ""} disabled={disabled} onChange={(event) => update({ ...discount, value: event.target.value })} />
    </label>
    <label className="customer-document-discount-reason">Reason
      <input required minLength="2" maxLength="500" placeholder="Why is this discount being applied?" value={discount.reason || ""} disabled={disabled} onChange={(event) => update({ ...discount, reason: event.target.value })} />
    </label>
  </> : null;

  const typeSelector = <Dropdown aria-label="Discount type" disabled={disabled} value={discount?.kind || "none"} onChange={(event) => {
    if (event.target.value === "none") { update(null); return; }
    update({ kind: event.target.value, value: discount?.kind === event.target.value ? discount.value : "", reason: discount?.reason || "" });
  }}>
    <option value="none">No discount</option>
    <option value="percentage">Percentage</option>
    <option value="fixed">Fixed amount</option>
  </Dropdown>;

  return <fieldset className={`customer-document-discount-editor${inline ? " is-inline" : ""}${active ? " is-active" : ""}`} disabled={disabled}>
    <legend className={inline ? "customer-document-discount-visually-hidden" : undefined}>{inline ? "Document discount" : "Discount"}</legend>
    {!inline ? <p>Apply one document discount. The server recalculates tax and totals.{percentageHint ? ` ${percentageHint}` : ""}</p> : null}
    <div className="customer-document-discount-fields">
      {!inline ? <><label>Type{typeSelector}</label>{detailFields}</> : <div className="customer-document-discount-type">
        <span>Discount</span>
        <DialogTrigger isOpen={detailsOpen} onOpenChange={setDetailsOpen}>
        <Button className={`customer-document-discount-summary${discountSummary !== "—" ? " has-discount" : ""}`} isDisabled={disabled} aria-label={`Edit discount: ${discountSummary}`}>
          <span className="customer-document-discount-value">{discountSummary}</span>
          <svg className="customer-document-discount-arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8 L8 8 L13 8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>
        <Popover className="customer-document-discount-popover" placement="top end" offset={8}>
          <Dialog aria-label="Discount details">
            <header className="customer-document-discount-popover-header"><h3>Discount</h3><Button onPress={() => setDetailsOpen(false)}>Done</Button></header>
            <div className="customer-document-discount-detail-fields"><label>Type{typeSelector}</label>{detailFields}</div>
            {percentageHint ? <p>{percentageHint}</p> : null}
          </Dialog>
        </Popover>
      </DialogTrigger></div>}
    </div>
  </fieldset>;
}
import { useEffect, useState } from "react";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
