export function customerDocumentMoney(value, currency = "USD") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(amount);
}

export function customerDocumentProjection(value = {}) {
  const document = value.document && typeof value.document === "object" ? value.document : value;
  const totals = value.totals && typeof value.totals === "object" ? value.totals : value;
  const lines = Array.isArray(value.lines) ? value.lines.map((line, index) => ({
    id: line.id || `line-${index + 1}`,
    description: String(line.description || "Repair item"),
    quantity: line.quantity ?? "",
    unit: line.unit || "",
    unitPrice: line.unitPrice ?? null,
    amount: line.total ?? line.amount ?? null,
    change: line.change || "unchanged",
  })) : [];
  return {
    type: document.type === "invoice" ? "invoice" : "estimate",
    number: String(document.number || "Draft"),
    revision: document.revision
      ? (String(document.revision).startsWith("R") ? String(document.revision) : `R${document.revision}`)
      : "",
    status: String(document.state || document.status || "draft"),
    currency: totals.currency || value.currency || "USD",
    issuedAt: document.issuedAt || "",
    expiresAt: document.expiresAt || "",
    shop: { ...(value.shop || {}), name: value.shop?.tradeName || value.shop?.legalName || value.shop?.name || "" },
    customer: value.customer || {},
    unit: { ...(value.unit || {}), name: value.unit?.label || value.unit?.name || "", detail: value.unit?.detail || [value.unit?.year, value.unit?.make, value.unit?.model].filter(Boolean).join(" ") },
    concern: String(value.concern || ""), lines,
    subtotal: totals.subtotal ?? null, discount: totals.discountTotal ?? totals.discount ?? null, tax: totals.tax ?? null,
    total: totals.total ?? null, terms: String(value.terms || ""),
    authorizationText: String(value.authorizationText || ""),
    financialFingerprint: String(value.financialFingerprint || ""),
    documentId: String(document.id || ""),
    revisionId: String(document.revisionId || ""),
    response: value.response && typeof value.response === "object" ? {
      status: String(value.response.status || "pending"),
      respondedAt: value.response.respondedAt || "",
      customerName: value.response.customerName || "",
    } : { status: "pending", respondedAt: "", customerName: "" },
    eligibility: value.eligibility && typeof value.eligibility === "object" ? {
      canRespond: value.eligibility.canRespond === true,
      canActivate: value.eligibility.canActivate === true,
    } : { canRespond: false, canActivate: false },
    relatedEstimate: value.relatedEstimate || null,
    authorization: value.authorization || null,
    source: value.source || "server",
  };
}

export function revisionDifference(previous = {}, proposed = {}) {
  const before = new Map((previous.lines || []).map((line) => [line.id, line]));
  const after = new Map((proposed.lines || []).map((line) => [line.id, line]));
  return [...new Set([...before.keys(), ...after.keys()])].map((id) => {
    const left = before.get(id); const right = after.get(id);
    const changed = !left || !right || left.amount !== right.amount || left.quantity !== right.quantity || left.description !== right.description;
    return { id, before: left || null, after: right || null, changed };
  }).filter((entry) => entry.changed);
}
