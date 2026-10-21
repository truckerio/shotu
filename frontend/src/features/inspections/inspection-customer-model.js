function normalizedName(value = "") { return String(value).trim().toLocaleLowerCase(); }

export function inspectionCustomerMatches(customers = [], name = "") {
  const normalized = normalizedName(name);
  return normalized ? customers.filter((customer) => customer.id && normalizedName(customer.name) === normalized) : [];
}

export function inspectionCustomerIdentity({ customers = [], customerAccountId = "", customerCompanyName = "", customerAddress } = {}) {
  const matches = inspectionCustomerMatches(customers, customerCompanyName);
  const explicit = matches.find((customer) => String(customer.id) === String(customerAccountId));
  const customer = explicit || (matches.length === 1 ? matches[0] : null);
  return { customerAccountId: customer?.id || "", customerCompanyName: customer?.name || customerCompanyName,
    customerAddress: customerAddress === undefined ? customer?.address || "" : customerAddress, ambiguous: !customer && matches.length > 1 };
}

export function inspectionCustomerSuggestions(customers = [], ownerName = "") {
  return [...new Set([ownerName, ...customers.map((customer) => customer.name)].map((name) => String(name || "").trim()).filter(Boolean))];
}

export function inspectionCustomerValidation(identity) {
  if (identity.ambiguous) return "Choose the saved customer company to use.";
  if (identity.customerAddress.trim() && !identity.customerCompanyName.trim()) return "Enter a customer company for this business address.";
  return "";
}
