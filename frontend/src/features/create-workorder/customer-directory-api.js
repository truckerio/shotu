import { api } from "../../lib/api.js";

function companyQuery(companyId) {
  return `companyId=${encodeURIComponent(companyId)}`;
}

export async function listCustomers(companyId) {
  const result = await api(`/api/customers?${companyQuery(companyId)}`);
  return Array.isArray(result.customers) ? result.customers : [];
}

export async function createCustomer({ companyId, name, address }) {
  const result = await api("/api/customers", { method: "POST", body: JSON.stringify({ companyId, name, address: address || undefined }) });
  return result.customer;
}

export async function updateCustomer({ companyId, customerId, name, address, version }) {
  const result = await api(`/api/customers/${encodeURIComponent(customerId)}`, { method: "PATCH", body: JSON.stringify({ companyId, name, address: address || undefined, version }) });
  return result.customer;
}

export async function listCustomerContacts({ companyId, customerId }) {
  const result = await api(`/api/customers/${encodeURIComponent(customerId)}/contacts?${companyQuery(companyId)}`);
  return Array.isArray(result.contacts) ? result.contacts : [];
}

export async function createCustomerContact({ companyId, customerId, name, email, phone }) {
  const result = await api(`/api/customers/${encodeURIComponent(customerId)}/contacts`, { method: "POST", body: JSON.stringify({ companyId, name, email: email || undefined, phone: phone || undefined }) });
  return result.contact;
}

export async function updateCustomerContact({ companyId, customerId, contactId, name, email, phone, version }) {
  const result = await api(`/api/customers/${encodeURIComponent(customerId)}/contacts/${encodeURIComponent(contactId)}`, { method: "PATCH", body: JSON.stringify({ companyId, name, email: email || undefined, phone: phone || undefined, version }) });
  return result.contact;
}
