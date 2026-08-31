const SOURCE_LABELS = {
  invoice: "Invoice receipt",
  stock_count: "Inventory count",
  manual: "Added manually",
  receipt: "Inventory receipt",
};

export function serializedUnitSourceView(source) {
  const label = SOURCE_LABELS[source?.type] || "Inventory receipt";
  if (source?.type !== "invoice" || !source.id) return { label, details: "", href: "" };

  const details = [source.vendorName, source.invoiceNumber].filter(Boolean).join(" · ")
    || source.fileName
    || "Open invoice";
  const params = new URLSearchParams({
    adminView: "inventory",
    view: "inventory",
    invoiceRun: source.id,
  });
  return { label, details, href: `/?${params.toString()}` };
}
