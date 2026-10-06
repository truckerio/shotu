import { CUSTOMER_DOCUMENT_SCHEMA_VERSION } from "../../../../shared/customer-document-contract.js";
import { customerDocumentProjectionInputSchema } from "./customer-financial.schemas.js";
import { calculateCustomerFinancials, canonicalFinancialHash } from "./customer-financial-calculator.js";

export function buildCustomerDocumentProjection(rawInput) {
  const input = customerDocumentProjectionInputSchema.parse(rawInput);
  const financial = calculateCustomerFinancials(input.financial);
  const projection = {
    schemaVersion: CUSTOMER_DOCUMENT_SCHEMA_VERSION,
    document: input.document,
    shop: input.shop,
    customer: input.customer,
    unit: input.unit,
    concern: input.concern,
    repairDescription: input.repairDescription,
    lines: financial.lines,
    totals: financial.summary,
    basis: financial.basis,
    terms: input.terms,
    authorizationText: input.authorizationText,
    warrantyText: input.warrantyText,
    footer: input.footer,
    profileVersionId: input.profileVersionId,
    templateVersion: input.templateVersion,
    taxProfileVersionId: input.taxProfileVersionId,
    relatedDocuments: input.relatedDocuments,
    response: input.response,
    sourceEvidence: input.sourceEvidence,
    discountEvidence: input.discountEvidence,
    financialFingerprint: financial.fingerprint,
  };
  return { projection, contentHash: canonicalFinancialHash(projection) };
}
