import { z } from "zod";
import { DATABASE_UUID_PATTERN } from "../../db/company.js";

const uuid = z.string().uuid();
const companyId = z.string().regex(DATABASE_UUID_PATTERN, "Invalid company ID");
const idempotencyKey = z.string().trim().min(8).max(120);
const body = z.string().trim().min(1).max(5000);

export const customerDocumentCustomerChatMessageSchema = z.object({
  body,
  customerName: z.string().trim().min(1).max(300),
  idempotencyKey,
}).strict();

export const staffCustomerDocumentChatMessageSchema = z.object({
  companyId,
  locationId: uuid,
  workorderId: uuid,
  documentId: uuid,
  revisionId: uuid,
  body,
  idempotencyKey,
}).strict();

export const staffCustomerDocumentChatQuerySchema = z.object({
  companyId,
  locationId: uuid,
  documentId: uuid,
  revisionId: uuid,
}).strict();
