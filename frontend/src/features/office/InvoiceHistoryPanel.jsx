import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { FileCheck02, Printer, RefreshCw01, SearchMd } from "@untitledui/icons";
import { useCheckpointPages } from "../../components/operations/useCheckpointPages.js";
import { Button } from "../../components/ui/Button.jsx";
import { CheckpointCollection } from "../../components/ui/CheckpointCollection.jsx";
import { readCheckpointPosition, saveCheckpointPosition } from "../../components/operations/checkpoint-position.js";
import { api } from "../../lib/api.js";

const PAGE_SIZE = 20;

function invoiceHistoryStorageKey(query, status) {
  return `invoice-history:${JSON.stringify([query.trim(), status])}`;
}

function waitForInvoiceQuery(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The invoice request was aborted.", "AbortError"));
      return;
    }
    const timer = window.setTimeout(resolve, 200);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("The invoice request was aborted.", "AbortError"));
    }, { once: true });
  });
}

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
  const focusedIdRef = useRef("");
  const queryKey = useMemo(() => JSON.stringify([query.trim(), status]), [query, status]);
  const storageKey = invoiceHistoryStorageKey(query, status);
  const initialPage = readCheckpointPosition(storageKey)?.page || page;
  const fetchPage = useCallback(async (nextPage, { signal }) => {
    await waitForInvoiceQuery(signal);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(nextPage) });
    if (query.trim()) params.set("q", query.trim());
    if (status) params.set("status", status);
    const result = await api(`/api/office/inventory/invoices?${params}`, { signal });
    return {
      items: Array.isArray(result.invoices) ? result.invoices : [],
      total: Number(result.total) || 0,
      pageCount: Number(result.pageCount) || 1,
      page: nextPage,
    };
  }, [query, status]);
  const invoiceQueue = useCheckpointPages({
    queryKey,
    fetchPage,
    initialPage,
    getItemKey: (invoice) => invoice.id,
  });

  useEffect(() => {
    if (!returnFocusId || invoiceQueue.loading || focusedIdRef.current === returnFocusId) return;
    const target = document.querySelector(`[data-invoice-run="${CSS.escape(returnFocusId)}"]`);
    if (target) {
      target.focus();
      focusedIdRef.current = returnFocusId;
    }
  }, [invoiceQueue.loading, invoiceQueue.pages, returnFocusId]);

  return (
    <section className="invoice-history" aria-labelledby="invoice-history-title">
      <header className="invoice-history-heading">
        <div><h3 id="invoice-history-title">Recent invoices</h3><p>Review intake status or reopen completed invoices.</p></div>
      </header>
      <div className="invoice-history-toolbar">
        <label className="invoice-history-search"><span>Search invoices</span><span><SearchMd aria-hidden="true" /><input value={query} onChange={(event) => { saveCheckpointPosition(invoiceHistoryStorageKey(event.target.value, status), { page: 1 }); onQueryChange(event.target.value); onPageChange(1); }} placeholder="Vendor or invoice number" /></span></label>
        <label><span>Status</span><Dropdown value={status} onChange={(event) => { saveCheckpointPosition(invoiceHistoryStorageKey(query, event.target.value), { page: 1 }); onStatusChange(event.target.value); onPageChange(1); }}>
          <option value="">All</option>
          <option value="needs_review">Needs review</option>
          <option value="reviewed">Ready to add</option>
          <option value="added">Added</option>
          <option value="processing">Extracting</option>
          <option value="failed">Failed</option>
          <option value="reversed">Reversed</option>
        </Dropdown></label>
      </div>
      {!invoiceQueue.pages.length && invoiceQueue.loading ? <div className="invoice-history-empty"><RefreshCw01 className="loading-icon" aria-hidden="true" /><strong>Loading invoices</strong></div> : null}
      {invoiceQueue.pages.length || invoiceQueue.error || !invoiceQueue.loading ? <div className={`invoice-history-results${invoiceQueue.loading || invoiceQueue.loadingMore ? " is-refreshing" : ""}`} aria-busy={invoiceQueue.loading || invoiceQueue.loadingMore}>
        <CheckpointCollection
          queue={invoiceQueue}
          label="invoices"
          pageSize={PAGE_SIZE}
          storageKey={storageKey}
          ariaLabel="Recent invoices"
          getItemKey={(invoice) => invoice.id}
          renderItems={(entries) => <div className="invoice-history-list">
            {entries.map(({ item: invoice, key, rowProps }) => {
              const openable = canOpenInvoice(invoice);
              const name = invoice.vendorName || invoice.fileName;
              return <article {...rowProps} key={key}>
                <div className="invoice-history-identity"><span className={`invoice-history-state is-${invoice.inventoryStatus}`}>{statusLabel(invoice.inventoryStatus)}</span>{openable ? <button type="button" className="invoice-history-name" data-invoice-run={invoice.id} onClick={() => onOpen(invoice.id)}>{name}</button> : <strong>{name}</strong>}<small>{invoice.invoiceNumber || "No invoice number"} · {invoice.locationName}</small></div>
                <div className="invoice-history-amount"><strong>{money(invoice.total, invoice.currency)}</strong><small>{invoiceDate(invoice)}</small></div>
                <div className="invoice-history-actions">
                  {invoice.receipt?.labelBatch?.status === "ready" ? <a className="button secondary" href={invoice.receipt.labelBatch.printUrl} target="_blank" rel="noreferrer"><Printer aria-hidden="true" />Print QRs</a> : null}
                  {invoice.inventoryStatus === "reviewed" ? <Button type="button" onClick={() => onOpen(invoice.id)}>Add inventory</Button> : null}
                </div>
              </article>;
            })}
          </div>}
        >
          <div className="invoice-history-empty"><FileCheck02 aria-hidden="true" /><strong>No invoices found</strong><p>{query || status ? "Change the search or status filter." : "Uploaded invoices will appear here."}</p></div>
        </CheckpointCollection>
      </div> : null}
    </section>
  );
}
