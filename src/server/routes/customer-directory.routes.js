import { z } from "zod";
import {
  listCustomers, createCustomer, updateCustomer, listCustomerContacts,
  createCustomerContact, updateCustomerContact,
} from "../modules/customers/customer-directory.service.js";

const id = z.string().uuid();

export async function handleCustomerDirectoryApi(req, res, url, helpers, dependencies = {}) {
  const { readBody, requestContext, sendJson } = helpers;
  const query = { companyId: url.searchParams.get("companyId") };
  if (url.pathname === "/api/customers") {
    if (req.method === "GET") {
      sendJson(res, 200, { customers: await (dependencies.listCustomers || listCustomers)(requestContext, query) });
      return true;
    }
    if (req.method === "POST") {
      sendJson(res, 201, { customer: await (dependencies.createCustomer || createCustomer)(requestContext, await readBody(req)) });
      return true;
    }
  }
  const contactMatch = /^\/api\/customers\/([^/]+)\/contacts(?:\/([^/]+))?$/.exec(url.pathname);
  if (contactMatch) {
    const customerId = id.parse(decodeURIComponent(contactMatch[1]));
    const contactId = contactMatch[2] ? id.parse(decodeURIComponent(contactMatch[2])) : null;
    if (req.method === "GET" && !contactId) {
      sendJson(res, 200, { contacts: await (dependencies.listContacts || listCustomerContacts)(requestContext, customerId, query) });
      return true;
    }
    if (req.method === "POST" && !contactId) {
      sendJson(res, 201, { contact: await (dependencies.createContact || createCustomerContact)(requestContext, customerId, await readBody(req)) });
      return true;
    }
    if (req.method === "PATCH" && contactId) {
      sendJson(res, 200, { contact: await (dependencies.updateContact || updateCustomerContact)(requestContext, customerId, contactId, await readBody(req)) });
      return true;
    }
  }
  const customerMatch = /^\/api\/customers\/([^/]+)$/.exec(url.pathname);
  if (customerMatch && req.method === "PATCH") {
    sendJson(res, 200, { customer: await (dependencies.updateCustomer || updateCustomer)(requestContext, id.parse(decodeURIComponent(customerMatch[1])), await readBody(req)) });
    return true;
  }
  return false;
}
