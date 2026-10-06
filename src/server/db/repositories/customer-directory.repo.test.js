import assert from "node:assert/strict";
import test from "node:test";
import {
  CustomerDirectoryIdentityError,
  listCustomers,
  resolveWorkorderCustomerIdentity,
} from "./customer-directory.repo.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const customerId = "33333333-3333-4333-8333-333333333333";
const contactId = "44444444-4444-4444-8444-444444444444";

test("customer directory listing returns contact summaries in one tenant-scoped query", async () => {
  const calls = [];
  const customers = await listCustomers({ companyId }, {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{
        id: customerId, company_id: companyId, name: "Acme Fleet", address: "1 Main St", version: 1,
        contacts: [{ id: contactId, company_id: companyId, customer_id: customerId, name: "Sam", email: "sam@example.com", phone: null, version: 1 }],
        contact_count: 1,
      }] };
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [companyId]);
  assert.match(calls[0].sql, /left join lateral/i);
  assert.equal(customers[0].contactCount, 1);
  assert.equal(customers[0].contacts[0].email, "sam@example.com");
});

function directoryDb() {
  const calls = [];
  let storedCustomer = null;
  let storedContact = null;
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [{ pg_advisory_xact_lock: null }] };
      if (/select \* from customer_directory_customers[\s\S]*lower\(name\)/i.test(sql)) {
        return { rows: storedCustomer ? [storedCustomer] : [] };
      }
      if (/insert into customer_directory_customers/i.test(sql)) {
        storedCustomer = {
          id: customerId, company_id: params[0], name: params[1], address: params[2], version: 1,
          created_at: "2026-10-03T20:00:00.000Z", updated_at: "2026-10-03T20:00:00.000Z",
        };
        return { rows: [storedCustomer] };
      }
      if (/select \* from customer_directory_contacts[\s\S]*lower\(name\)/i.test(sql)) {
        return { rows: storedContact ? [storedContact] : [] };
      }
      if (/insert into customer_directory_contacts/i.test(sql)) {
        storedContact = {
          id: contactId, company_id: params[0], customer_id: params[1], name: params[2],
          email: params[3], phone: params[4], version: 1,
          created_at: "2026-10-03T20:00:00.000Z", updated_at: "2026-10-03T20:00:00.000Z",
        };
        return { rows: [storedContact] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test("typed Workorder customer and contact create once then reuse normalized exact names", async () => {
  const db = directoryDb();
  const input = {
    companyId,
    actorId,
    formData: {
      customerCompanyName: "  Acme Fleet  ",
      customerAddress: "  1 Main St  ",
      customerContactName: "  Sam Driver ",
      customerContactEmail: " sam@example.com ",
      customerContactPhone: " 555-0100 ",
    },
  };
  const created = await resolveWorkorderCustomerIdentity(input, db);
  const replayed = await resolveWorkorderCustomerIdentity(input, db);

  assert.equal(created.formData.customerCompanyName, "Acme Fleet");
  assert.equal(created.formData.customerAccountId, customerId);
  assert.equal(created.formData.customerContactId, contactId);
  assert.equal(created.formData.customerContactEmail, "sam@example.com");
  assert.deepEqual(replayed.formData, created.formData);
  assert.equal(db.calls.filter(({ sql }) => /pg_advisory_xact_lock/i.test(sql)).length, 2);
  assert.equal(db.calls.filter(({ sql }) => /insert into customer_directory_customers/i.test(sql)).length, 1);
  assert.equal(db.calls.filter(({ sql }) => /insert into customer_directory_contacts/i.test(sql)).length, 1);
  assert.deepEqual(db.calls.find(({ sql }) => /pg_advisory_xact_lock/i.test(sql)).params, [companyId, "acme fleet"]);
});

test("an email-only unmatched contact is retained and receives a stable directory identity", async () => {
  const db = directoryDb();
  const resolved = await resolveWorkorderCustomerIdentity({
    companyId, actorId,
    formData: { customerCompanyName: "Acme", customerContactEmail: "dispatch@acme.test" },
  }, db);
  assert.equal(resolved.contact.name, "dispatch@acme.test");
  assert.equal(resolved.formData.customerContactId, contactId);
});

test("selected customer and contact IDs are tenant-scoped and remain authoritative", async () => {
  const customerRow = { id: customerId, company_id: companyId, name: "Canonical Fleet", address: "2 Main St", version: 2 };
  const contactRow = { id: contactId, company_id: companyId, customer_id: customerId, name: "Alex", email: "alex@test", phone: null, version: 1 };
  const calls = [];
  const resolved = await resolveWorkorderCustomerIdentity({
    companyId, actorId,
    formData: { customerAccountId: customerId, customerContactId: contactId, customerCompanyName: "Browser label" },
  }, {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/customer_directory_customers/.test(sql)) return { rows: [customerRow] };
      if (/customer_directory_contacts/.test(sql)) return { rows: [contactRow] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  });
  assert.equal(resolved.formData.customerCompanyName, "Canonical Fleet");
  assert.equal(resolved.formData.customerContactName, "Alex");
  assert.equal(calls.some(({ sql }) => /insert/i.test(sql)), false);

  await assert.rejects(resolveWorkorderCustomerIdentity({
    companyId, actorId, formData: { customerAccountId: customerId },
  }, { query: async () => ({ rows: [] }) }),
  (error) => error instanceof CustomerDirectoryIdentityError
    && error.code === "CUSTOMER_DIRECTORY_SELECTION_INVALID");

  await assert.rejects(resolveWorkorderCustomerIdentity({
    companyId, actorId, formData: { customerAccountId: "not-a-uuid" },
  }, { query: async () => { throw new Error("Invalid IDs must not reach PostgreSQL."); } }),
  (error) => error instanceof CustomerDirectoryIdentityError
    && error.code === "CUSTOMER_DIRECTORY_SELECTION_INVALID");

  await assert.rejects(resolveWorkorderCustomerIdentity({
    companyId, actorId, formData: { customerContactId: contactId, customerCompanyName: "Typed" },
  }, { query: async () => { throw new Error("An orphan contact selection must not reach PostgreSQL."); } }),
  (error) => error instanceof CustomerDirectoryIdentityError
    && error.code === "CUSTOMER_DIRECTORY_CONTACT_SELECTION_INVALID");
});
