import { Dropdown } from "../../components/forms/Dropdown.jsx";
import "./customer-document-discount-editor.css";

function noDiscount() {
  return { lineDiscounts: [], documentDiscount: null, overrideReasons: [] };
}

export function CustomerDocumentDiscountEditor({ adjustments, onChange, disabled = false, inline = false, maximumOfficePercentage = null }) {
  const discount = adjustments?.documentDiscount || null;
  const update = (next) => onChange?.({ ...noDiscount(), documentDiscount: next });
  const active = Boolean(discount);
  const percentageHint = maximumOfficePercentage !== null && maximumOfficePercentage !== undefined
    ? `Office discounts are limited to ${maximumOfficePercentage}%.`
    : "";

  return <fieldset className={`customer-document-discount-editor${inline ? " is-inline" : ""}${active ? " is-active" : ""}`} disabled={disabled}>
    <legend className={inline ? "customer-document-discount-visually-hidden" : undefined}>{inline ? "Document discount" : "Discount"}</legend>
    {!inline ? <p>Apply one document discount. The server recalculates tax and totals.{percentageHint ? ` ${percentageHint}` : ""}</p> : null}
    <div className="customer-document-discount-fields">
      <label className={inline ? "customer-document-discount-type" : undefined}>{inline ? <span>Discount</span> : "Type"}
        <Dropdown aria-label="Discount type" disabled={disabled} value={discount?.kind || "none"} onChange={(event) => {
          if (event.target.value === "none") { update(null); return; }
          update({ kind: event.target.value, value: discount?.kind === event.target.value ? discount.value : "", reason: discount?.reason || "" });
        }}>
          <option value="none">No discount</option>
          <option value="percentage">Percentage</option>
          <option value="fixed">Fixed amount</option>
        </Dropdown>
      </label>
      {active ? <label>{discount.kind === "percentage" ? "Percent" : "Amount"}
        <input inputMode="decimal" min="0" max={discount.kind === "percentage" ? "100" : undefined} placeholder={discount.kind === "percentage" ? "0" : "0.00"} value={discount.value || ""} onChange={(event) => update({ ...discount, value: event.target.value })} />
      </label> : null}
      {active ? <label className="customer-document-discount-reason">Reason
        <input required minLength="2" maxLength="500" placeholder="Why is this discount being applied?" value={discount.reason || ""} onChange={(event) => update({ ...discount, reason: event.target.value })} />
      </label> : null}
    </div>
    {inline && percentageHint ? <p>{percentageHint}</p> : null}
  </fieldset>;
}
