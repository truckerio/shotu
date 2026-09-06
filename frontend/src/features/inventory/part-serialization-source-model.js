const SOURCE_LABELS = {
  invoice: "Invoice receipt",
  stock_count: "Inventory count",
  manual: "Added manually",
  receipt: "Inventory receipt",
  legacy_tracking: "Earlier physical history unavailable",
};

export function serializedUnitSourceView(source) {
  const label = SOURCE_LABELS[source?.type] || "Inventory receipt";
  if (source?.type === "legacy_tracking") return { label, details: "Tracking begins with the recorded removal.", href: "" };
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
