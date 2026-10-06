function text(value) {
  return String(value || "").trim();
}

export const APPROVAL_NOT_REQUIRED = "approval_not_required";
export const REQUIRED_EXTERNAL_CUSTOMER = "required_external_customer";

export function approvalClassificationForRequest(askForApproval) {
  return askForApproval ? REQUIRED_EXTERNAL_CUSTOMER : APPROVAL_NOT_REQUIRED;
}

export function askForCustomerApproval(classification) {
  return classification === REQUIRED_EXTERNAL_CUSTOMER;
}

export function customerAccountOptions(customers) {
  return (Array.isArray(customers) ? customers : [])
    .filter((customer) => text(customer?.id) && text(customer?.name))
    .map((customer) => ({ id: String(customer.id), label: text(customer.name), customer }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function contactOptions(customer) {
  return (Array.isArray(customer?.contacts) ? customer.contacts : [])
    .filter((contact) => text(contact?.id) && text(contact?.name || contact?.email))
    .map((contact) => ({
      id: String(contact.id),
      label: [text(contact.name), text(contact.email)].filter(Boolean).join(" · "),
      contact,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function selectedCustomer(customers, customerAccountId) {
  return customerAccountOptions(customers).find((option) => option.id === String(customerAccountId || ""))?.customer || null;
}

export function exactCustomerNameMatch(customers, customerCompanyName) {
  const normalizedName = text(customerCompanyName).toLocaleLowerCase();
  if (!normalizedName) return null;
  return customerAccountOptions(customers).find((option) => option.label.toLocaleLowerCase() === normalizedName)?.customer || null;
}

export function customerDirectorySelectionState({ customers, customerAccountId, customerCompanyName }) {
  const selected = selectedCustomer(customers, customerAccountId);
  if (selected) return { kind: "selected", customer: selected };
  const exactMatch = exactCustomerNameMatch(customers, customerCompanyName);
  return exactMatch ? { kind: "available_match", customer: exactMatch } : { kind: "typed_unmatched", customer: null };
}

export function customerSelectionPatch({ customer = null, contact = null, fallbackName = "" }) {
  return {
    customerAccountId: customer?.id ? String(customer.id) : "",
    customerContactId: contact?.id ? String(contact.id) : "",
    customerAddress: "",
    customerContactName: "",
    customerContactEmail: "",
    // The legacy name is intentionally retained as an immutable display fallback.
    customerCompanyName: text(customer?.name) || text(fallbackName),
  };
}

export function clearCustomerContactSelection() {
  return { customerAccountId: "", customerContactId: "" };
}
