import { AuthError, permissionDenied, resourceNotFound } from "../../auth/errors.js";
import { requireCompanyAccess } from "../../auth/authorize.js";
import * as repository from "../../db/repositories/customer-directory.repo.js";
import {
  customerDirectoryQuerySchema, createCustomerSchema, updateCustomerSchema,
  createCustomerContactSchema, updateCustomerContactSchema,
} from "./customer-directory.schemas.js";

function scope(context, companyId) {
  if (!["office", "admin"].includes(context?.actor?.role)) throw permissionDenied();
  requireCompanyAccess(context, companyId);
  return context.actor.id;
}

function mutationResult(value) {
  if (!value) throw new AuthError(409, "CUSTOMER_DIRECTORY_VERSION_CONFLICT", "Customer record changed or is unavailable. Refresh and try again.");
  return value;
}

export async function listCustomers(context, rawInput, dependencies = {}) {
  const input = customerDirectoryQuerySchema.parse(rawInput);
  scope(context, input.companyId);
  return (dependencies.listCustomers || repository.listCustomers)(input);
}

export async function createCustomer(context, rawInput, dependencies = {}) {
  const input = createCustomerSchema.parse(rawInput);
  const actorId = scope(context, input.companyId);
  return (dependencies.createCustomer || repository.createCustomer)({ ...input, actorId });
}

export async function updateCustomer(context, customerId, rawInput, dependencies = {}) {
  const input = updateCustomerSchema.parse(rawInput);
  const actorId = scope(context, input.companyId);
  return mutationResult(await (dependencies.updateCustomer || repository.updateCustomer)({ ...input, customerId, actorId }));
}

export async function listCustomerContacts(context, customerId, rawInput, dependencies = {}) {
  const input = customerDirectoryQuerySchema.parse(rawInput);
  scope(context, input.companyId);
  return (dependencies.listContacts || repository.listCustomerContacts)({ ...input, customerId });
}

export async function createCustomerContact(context, customerId, rawInput, dependencies = {}) {
  const input = createCustomerContactSchema.parse(rawInput);
  const actorId = scope(context, input.companyId);
  const created = await (dependencies.createContact || repository.createCustomerContact)({ ...input, customerId, actorId });
  if (!created) throw resourceNotFound("Customer");
  return created;
}

export async function updateCustomerContact(context, customerId, contactId, rawInput, dependencies = {}) {
  const input = updateCustomerContactSchema.parse(rawInput);
  const actorId = scope(context, input.companyId);
  return mutationResult(await (dependencies.updateContact || repository.updateCustomerContact)({ ...input, customerId, contactId, actorId }));
}
