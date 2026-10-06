export function customerDirectoryCompanyId(actor = {}) {
  return actor.companyMemberships?.[0]?.companyId || actor.companyIds?.[0] || "";
}

export function customerContactSummary(contacts) {
  if (!Array.isArray(contacts)) return "Loading contacts…";
  if (!contacts.length) return "No contacts on file";
  const first = contacts[0];
  const detail = [first.email, first.phone].filter(Boolean).join(" · ");
  return `${first.name || "Unnamed contact"}${detail ? ` · ${detail}` : ""}`;
}

export function customerMatchesSearch(customer, query) {
  const normalized = String(query || "").trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [customer?.name, customer?.address]
    .filter(Boolean)
    .some((value) => String(value).toLocaleLowerCase().includes(normalized));
}
