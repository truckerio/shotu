export function invoiceField(field) {
  const value = field?.value;
  return value === null || value === undefined || value === "" ? null : value;
}

export function invoiceNumber(value) {
  return value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? "Not read"
    : Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function invoiceQuantity(value) {
  return value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? "Not read"
    : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function invoiceDocumentChoices(item, result = {}) {
  const choices = (result.items || []).map((bill) => ({
    key: `bill:${bill.id}`, billId: bill.id, invoiceRunId: bill.invoiceRunId || "", sourceRunIds: bill.sourceRunIds || [], fileName: bill.file_name,
    sourceUrl: `/api/office/inventory/purchasing/${encodeURIComponent(item.poId)}/bills/${encodeURIComponent(bill.id)}`,
  }));
  const exactRunId = item.selectedDelivery?.invoiceRunId;
  const runIds = [...(result.linkedInvoices || []), ...(exactRunId ? [{ invoiceRunId: exactRunId, fileName: item.invoiceNumber }] : []),
    ...(item.invoiceRunId ? [{ invoiceRunId: item.invoiceRunId, fileName: item.invoiceNumber }] : [])];
  for (const run of runIds) {
    if (!run.invoiceRunId) continue;
    const existing = choices.find((entry) => entry.invoiceRunId === run.invoiceRunId || entry.sourceRunIds?.includes(run.invoiceRunId) || run.sourceRunIds?.includes(entry.invoiceRunId));
    if (existing) {
      // A newer scoped reading can arrive between the attachment and allocation reads.
      if (run.sourceRunIds?.includes(existing.invoiceRunId) && !existing.sourceRunIds?.includes(run.invoiceRunId)) {
        existing.invoiceRunId = run.invoiceRunId;
        existing.sourceRunIds = run.sourceRunIds;
      }
      continue;
    }
    choices.push({ key: `run:${run.invoiceRunId}`, invoiceRunId: run.invoiceRunId, sourceRunIds: run.sourceRunIds || [], fileName: run.fileName || "Uploaded invoice" });
  }
  return choices;
}

export function preferredInvoiceChoice(choices, item, selectedKey = "") {
  return choices.find((entry) => entry.key === selectedKey)
    || choices.find((entry) => entry.invoiceRunId === item.selectedDelivery?.invoiceRunId || entry.sourceRunIds?.includes(item.selectedDelivery?.invoiceRunId))
    || choices[0] || null;
}

export function invoiceDocumentState(run) {
  if (!run) return "empty";
  if (run.status === "processing") return "processing";
  if (run.status === "failed") return "failed";
  return run.draft ? "ready" : "empty";
}
