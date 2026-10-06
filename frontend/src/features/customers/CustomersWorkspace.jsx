import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button.jsx";
import { SecondaryDetailPanel, SecondaryDetailSection } from "../../components/ui/SecondaryDetailPanel.jsx";
import { OperationalCollectionCell, OperationalCollectionPage, OperationalCollectionResultHeader, OperationalCollectionRow, OperationalCollectionTable, OperationalCollectionToolbar } from "../../components/operations/OperationalCollectionPage.jsx";
import { api } from "../../lib/api.js";
import { customerContactSummary, customerDirectoryCompanyId, customerMatchesSearch } from "./customers-directory-model.js";
import "./customers-workspace.css";

const columns = [{ id: "customer", label: "Customer" }, { id: "address", label: "Address" }, { id: "contacts", label: "Contacts" }];

export function CustomersWorkspace({ actor, presentation = "embedded" }) {
  const companyId = customerDirectoryCompanyId(actor);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!companyId) {
      setCustomers([]); setLoading(false); setError("No company is available for this account.");
      return undefined;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError(""); setSelected(null);
    api(`/api/customers?${new URLSearchParams({ companyId })}`, { signal: controller.signal })
      .then((result) => {
        const directory = Array.isArray(result.customers) ? result.customers : [];
        if (!active) return;
        setCustomers(directory);
      })
      .catch((failure) => {
        if (active && failure.name !== "AbortError") { setCustomers([]); setError(failure.message); }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [companyId, retry]);

  const visibleCustomers = useMemo(() => customers.filter((customer) => customerMatchesSearch(customer, query)), [customers, query]);
  const selectedContacts = selected?.contacts || [];

  return <OperationalCollectionPage presentation={presentation} surface className="customers-workspace">
    <OperationalCollectionToolbar className="customers-toolbar"><label className="customers-search"><span>Search customers</span><input type="search" value={query} placeholder="Name or address" onChange={(event) => setQuery(event.target.value)} /></label></OperationalCollectionToolbar>
    <OperationalCollectionResultHeader><span role="status">{loading ? "Loading customers…" : error ? "Customers could not be loaded" : `${visibleCustomers.length} customers`}</span></OperationalCollectionResultHeader>
    {error ? <div className="customers-feedback" role="alert"><p>{error}</p>{companyId ? <Button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</Button> : null}</div> : null}
    {!loading && !error && !visibleCustomers.length ? <p className="customers-feedback">{query ? "No customers match that search." : "No customers have been recorded yet."}</p> : null}
    {!error && (loading || visibleCustomers.length > 0) ? <OperationalCollectionTable columns={columns} ariaLabel="Customers" busy={loading}>{visibleCustomers.map((customer) => {
      const contacts = Array.isArray(customer.contacts) ? customer.contacts : [];
      return <OperationalCollectionRow key={customer.id} onAction={() => setSelected(customer)} ariaLabel={`Open ${customer.name || "customer"}`}>
        <OperationalCollectionCell label="Customer"><strong>{customer.name || "Unnamed customer"}</strong></OperationalCollectionCell>
        <OperationalCollectionCell label="Address">{customer.address || "No address recorded"}</OperationalCollectionCell>
        <OperationalCollectionCell label="Contacts"><div className="customers-contact-cell"><strong>{`${customer.contactCount ?? contacts.length} ${(customer.contactCount ?? contacts.length) === 1 ? "contact" : "contacts"}`}</strong><span>{customerContactSummary(contacts)}</span></div></OperationalCollectionCell>
      </OperationalCollectionRow>;
    })}</OperationalCollectionTable> : null}
    <SecondaryDetailPanel open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} onClose={() => setSelected(null)} title={selected?.name || "Customer"} eyebrow="Customer">
      {selected ? <><SecondaryDetailSection title="Address"><p className="customers-detail-value">{selected.address || "No address recorded"}</p></SecondaryDetailSection><SecondaryDetailSection title={`Contacts (${selectedContacts.length})`}>{selectedContacts.length ? <ul className="customers-contact-list">{selectedContacts.map((contact) => <li key={contact.id}><strong>{contact.name || "Unnamed contact"}</strong><span>{[contact.email, contact.phone].filter(Boolean).join(" · ") || "No email or phone recorded"}</span></li>)}</ul> : <p className="customers-detail-value">No contacts on file.</p>}</SecondaryDetailSection></> : null}
    </SecondaryDetailPanel>
  </OperationalCollectionPage>;
}
