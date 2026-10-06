import { CustomerCompanyField, Dropdown } from "../../components/forms/index.js";
import { UnitDetailsPopover } from "../../components/workorders/UnitDetailsPopover.jsx";
import { useEffect, useState } from "react";
import { ApprovalRequestControl } from "./ApprovalRequestControl.jsx";
import { contactOptions, customerAccountOptions, customerDirectorySelectionState, customerSelectionPatch, selectedCustomer } from "./customer-contact-model.js";

export function CustomerDirectoryField({ customers = [], customerAccountId = "", customerCompanyName = "", customerContactId = "", customerAddress = "", customerContactEmail = "", disabled = false, error = "", exceptionControls = null, loading = false, onApprovalChange, onNameChange, onSelectionChange, onUnmatchedDetailsChange, approvalClassification, required = false, requiredLabel = "Required", suggestions = [], suggestionsLabel }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const customer = selectedCustomer(customers, customerAccountId);
  const directoryState = customerDirectorySelectionState({ customers, customerAccountId, customerCompanyName });
  const contacts = contactOptions(customer);
  useEffect(() => {
    if (directoryState.kind !== "available_match") return;
    onSelectionChange?.(customerSelectionPatch({
      customer: directoryState.customer,
      fallbackName: customerCompanyName,
    }));
  }, [customerCompanyName, directoryState.customer, directoryState.kind, onSelectionChange]);
  function selectCustomer(customerId) {
    const nextCustomer = selectedCustomer(customers, customerId);
    onSelectionChange?.(nextCustomer
      ? customerSelectionPatch({ customer: nextCustomer, fallbackName: customerCompanyName })
      : { customerAccountId: "", customerContactId: "" });
  }
  function selectContact(contactId) { const contact = contacts.find((option) => option.id === String(contactId || ""))?.contact || null; onSelectionChange?.(customerSelectionPatch({ customer, contact, fallbackName: customerCompanyName })); }
  const unmatched = directoryState.kind !== "selected";
  return <div className="create-customer-directory-field"><CustomerCompanyField value={customerCompanyName} onChange={onNameChange} error={error} label="Customer" hint="" suggestions={suggestions} suggestionsLabel={suggestionsLabel} required={required} requiredLabel={requiredLabel} /><UnitDetailsPopover title="Customer details" open={detailsOpen} onToggle={setDetailsOpen}><section className="create-customer-directory-popover" aria-label="Customer details"><label className="customer-directory-customer">Customer<Dropdown value={customerAccountId} disabled={disabled || loading} onChange={(event) => selectCustomer(event.target.value)}><option value="">{customerCompanyName.trim() || "Select customer"}</option>{customerAccountOptions(customers).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</Dropdown></label>{unmatched ? <><label className="customer-directory-contact">Contact<input type="email" inputMode="email" placeholder="name@example.com" value={customerContactEmail} disabled={disabled} onChange={(event) => onUnmatchedDetailsChange?.({ customerContactEmail: event.target.value, customerContactName: "" })} /></label><label className="customer-directory-address">Address<input value={customerAddress} disabled={disabled} onChange={(event) => onUnmatchedDetailsChange?.({ customerAddress: event.target.value })} /></label></> : <><label className="customer-directory-contact">Contact<Dropdown value={customerContactId} disabled={disabled || loading} onChange={(event) => selectContact(event.target.value)}><option value="">No contact selected</option>{contacts.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</Dropdown></label><label className="customer-directory-address">Address<output>{customer?.address || "—"}</output></label></>}<ApprovalRequestControl classification={approvalClassification} disabled={disabled} onChange={onApprovalChange} />{exceptionControls}</section></UnitDetailsPopover></div>;
}
