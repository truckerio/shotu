import { z } from "zod";
import { DATABASE_UUID_PATTERN } from "../../db/company.js";

const companyId = z.string().regex(DATABASE_UUID_PATTERN);
const name = z.string().trim().min(1).max(300);
const email = z.string().trim().email().max(320).nullable().optional();

export const customerDirectoryQuerySchema = z.object({ companyId }).strict();
export const createCustomerSchema = z.object({
  companyId,
  name,
  address: z.string().trim().max(1000).nullable().optional(),
}).strict();
export const updateCustomerSchema = createCustomerSchema.extend({ version: z.number().int().positive() });
export const createCustomerContactSchema = z.object({
  companyId,
  name,
  email,
  phone: z.string().trim().max(100).nullable().optional(),
}).strict();
export const updateCustomerContactSchema = createCustomerContactSchema.extend({ version: z.number().int().positive() });
