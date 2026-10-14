// Issuance eligibility remains server-owned; the UI only chooses the next review.
export function shouldReviewInvoice(summary) {
  return summary?.status === "mechanic_done"
    && summary.reconciliation?.invoiceEligible === true
    && !summary.documents?.invoice;
}
