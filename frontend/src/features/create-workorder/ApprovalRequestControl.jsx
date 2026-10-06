import { Checkbox } from "../../components/ui/Checkbox.jsx";
import { Dropdown } from "../../components/forms/index.js";
import { askForCustomerApproval } from "./customer-contact-model.js";

export function ApprovalRequestControl({ classification, disabled = false, onChange }) {
  if (!classification) {
    return <section className="create-workorder-approval-request" aria-label="Customer approval"><label className="create-workorder-approval-choice">Customer approval<Dropdown value="" disabled={disabled} onChange={(event) => onChange?.(event.target.value === "required_external_customer")}><option value="" disabled>Choose approval</option><option value="approval_not_required">Not required</option><option value="required_external_customer">Ask for approval</option></Dropdown></label></section>;
  }
  const checked = askForCustomerApproval(classification);
  return <section className="create-workorder-approval-request" aria-label="Customer approval"><label className="create-workorder-approval-toggle"><Checkbox checked={checked} disabled={disabled} onChange={(event) => onChange?.(event.target.checked)} /><span>Ask for customer approval</span></label></section>;
}
