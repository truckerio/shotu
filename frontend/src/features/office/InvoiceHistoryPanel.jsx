import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { useEffect, useRef, useState } from "react";
import { FileCheck02, Printer, RefreshCw01, SearchMd } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { Pagination } from "../../components/ui/Pagination.jsx";
import { api } from "../../lib/api.js";

const PAGE_SIZE = 20;

function money(value, currency = "USD") {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value));
  } catch {
    return `${value} ${currency || ""}`.trim();
  }
}

function statusLabel(status) {
  return {
    added: "Added",
    reviewed: "Ready to add",
    needs_review: "Needs review",
    processing: "Extracting",
    reversed: "Reversed",
    failed: "Failed",
  }[status] || status;
}

function canOpenInvoice(invoice) {
  return ["reviewed", "needs_review", "added", "reversed"].includes(invoice.inventoryStatus);
}

function invoiceDate(invoice) {
  if (invoice.invoiceDate) return invoice.invoiceDate;
  return new Date(invoice.createdAt).toLocaleDateString();
}

export function InvoiceHistoryPanel({
  query,
  onQueryChange,
  status,
  onStatusChange,
  page,
  onPageChange,
  onOpen,
  returnFocusId = "",
}) {
  const [invoices, setInvoices] = useState([]);
  const [meta, setMeta] = useState({ total: 0, pageCount: 1 });
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const focusedIdRef = useRef("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(page) });
        if (query.trim()) params.set("q", query.trim());
        if (status) params.set("status", status);
        const result = await api(`/api/office/inventory/invoices?${params}`, { signal: controller.signal });
        if (!active) return;
        setInvoices(result.invoices || []);
        setMeta({ total: Number(result.total) || 0, pageCount: Number(result.pageCount) || 1 });
        setLoaded(true);
      } catch (nextError) {
        if (active) setError(nextError.message);
      } finally {
        if (active) setLoading(false);
      }
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [page, query, status]);

  useEffect(() => {
    if (!returnFocusId || loading || focusedIdRef.current === returnFocusId) return;
    const target = document.querySelector(`[data-invoice-run="${CSS.escape(returnFocusId)}"]`);
    if (target) {
      target.focus();
      focusedIdRef.current = returnFocusId;
    }
  }, [loading, returnFocusId]);

  const refreshing = loading && loaded;

  return (
    <section className="invoice-history" aria-labelledby="invoice-history-title">
      <header className="invoice-history-heading">
        <div><h3 id="invoice-history-title">Recent invoices</h3><p>Review intake status or reopen completed invoices.</p></div>
      </header>
      <div className="invoice-history-toolbar">
        <label className="invoice-history-search"><span>Search invoices</span><span><SearchMd aria-hidden="true" /><input value={query} onChange={(event) => { onQueryChange(event.target.value); onPageChange(1); }} placeholder="Vendor or invoice number" /></span></label>
        <label><span>Status</span><Dropdown value={status} onChange={(event) => { onStatusChange(event.target.value); onPageChange(1); }}>
          <option value="">All</option>
          <option value="needs_review">Needs review</option>
          <option value="reviewed">Ready to add</option>
          <option value="added">Added</option>
          <option value="processing">Extracting</option>
          <option value="failed">Failed</option>
          <option value="reversed">Reversed</option>
        </Dropdown></label>
      </div>
      {error ? <p className="ops-error" role="alert">{error}</p> : null}
      {!loaded && loading ? <div className="invoice-history-empty"><RefreshCw01 className="loading-icon" aria-hidden="true" /><strong>Loading invoices</strong></div> : null}
      {loaded ? <div className={`invoice-history-results${refreshing ? " is-refreshing" : ""}`} aria-busy={refreshing}>
        {invoices.length ? <div className="invoice-history-list">
          {invoices.map((invoice) => {
            const openable = canOpenInvoice(invoice);
            const name = invoice.vendorName || invoice.fileName;
            return <article key={invoice.id}>
              <div className="invoice-history-identity"><span className={`invoice-history-state is-${invoice.inventoryStatus}`}>{statusLabel(invoice.inventoryStatus)}</span>{openable ? <button type="button" className="invoice-history-name" data-invoice-run={invoice.id} onClick={() => onOpen(invoice.id)}>{name}</button> : <strong>{name}</strong>}<small>{invoice.invoiceNumber || "No invoice number"} · {invoice.locationName}</small></div>
              <div className="invoice-history-amount"><strong>{money(invoice.total, invoice.currency)}</strong><small>{invoiceDate(invoice)}</small></div>
              <div className="invoice-history-actions">
                {invoice.receipt?.labelBatch?.status === "ready" ? <a className="button secondary" href={invoice.receipt.labelBatch.printUrl} target="_blank" rel="noreferrer"><Printer aria-hidden="true" />Print QRs</a> : null}
                {invoice.inventoryStatus === "reviewed" ? <Button type="button" onClick={() => onOpen(invoice.id)}>Add inventory</Button> : null}
              </div>
            </article>;
          })}
        </div> : <div className="invoice-history-empty"><FileCheck02 aria-hidden="true" /><strong>No invoices found</strong><p>{query || status ? "Change the search or status filter." : "Uploaded invoices will appear here."}</p></div>}
        {meta.total ? <Pagination currentPage={page} pageCount={meta.pageCount} setPage={onPageChange} total={meta.total} label="invoices" /> : null}
      </div> : null}
    </section>
  );
}
