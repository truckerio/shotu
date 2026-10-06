import { z } from "zod";
import { AuthError } from "../../auth/errors.js";
import { requireCompanyAccess, requireLocationAccess, requirePermission } from "../../auth/authorize.js";
import { PERMISSION } from "../../auth/permissions.js";
import * as repository from "../../db/repositories/customer-documents.repo.js";

const uuid = z.string().uuid();
const querySchema = z.object({
  companyId: uuid,
  locationId: uuid,
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  grantLimit: z.coerce.number().int().min(1).max(50).optional().default(25),
}).strict();

function toIso(value) { return new Date(value).toISOString(); }

function boundedRange(input, now = new Date()) {
  const endAt = input.endAt ? new Date(input.endAt) : now;
  const startAt = input.startAt ? new Date(input.startAt) : new Date(endAt.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || startAt >= endAt) {
    throw new AuthError(400, "CUSTOMER_DOCUMENT_REPORT_RANGE_INVALID", "The reporting date range is invalid.");
  }
  if (endAt.getTime() - startAt.getTime() > 93 * 24 * 60 * 60 * 1000) {
    throw new AuthError(400, "CUSTOMER_DOCUMENT_REPORT_RANGE_TOO_LARGE", "Reporting is limited to 93 days at a time.");
  }
  return { startAt: toIso(startAt), endAt: toIso(endAt) };
}

function authorize(context, input) {
  requirePermission(context, PERMISSION.CUSTOMER_DOCUMENT_READ);
  requireCompanyAccess(context, input.companyId);
  requireLocationAccess(context, input.locationId);
}

function normalizeGroups(groups) {
  return groups.map((group) => ({
    documentType: group.documentType,
    state: group.state,
    currency: group.currency || null,
    count: Number(group.count),
    // Keep amount nullable rather than silently treating missing values as zero.
    totalAmount: group.totalAmount == null ? null : String(group.totalAmount),
  }));
}

export async function readCustomerDocumentReport(context, rawQuery, dependencies = {}) {
  const parsed = querySchema.parse(rawQuery);
  authorize(context, parsed);
  const range = boundedRange(parsed, dependencies.now ? new Date(dependencies.now) : new Date());
  const read = dependencies.readReport || repository.readCustomerDocumentReport;
  const report = await read({ ...parsed, ...range });
  return {
    range,
    documents: normalizeGroups(report.documents || []),
    grants: (report.grants || []).map((grant) => ({
      id: grant.id,
      tokenHint: grant.tokenHint,
      documentId: grant.documentId,
      revisionId: grant.revisionId,
      documentType: grant.documentType,
      documentNumber: grant.documentNumber,
      state: grant.state,
      issuedAt: grant.issuedAt,
      expiresAt: grant.expiresAt,
      revokedAt: grant.revokedAt || null,
      lastUsedAt: grant.lastUsedAt || null,
    })),
  };
}

export { boundedRange };
