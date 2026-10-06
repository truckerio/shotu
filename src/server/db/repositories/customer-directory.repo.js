import { query } from "../pool.js";
import { DATABASE_UUID_PATTERN } from "../company.js";

function customer(row) {
  return row && {
    id: row.id, companyId: row.company_id, name: row.name, address: row.address,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
    contacts: Array.isArray(row.contacts) ? row.contacts.map(contact).filter(Boolean) : [],
    contactCount: Number(row.contact_count ?? row.contacts?.length ?? 0),
  };
}

function contact(row) {
  return row && {
    id: row.id, companyId: row.company_id, customerId: row.customer_id,
    name: row.name, email: row.email, phone: row.phone, version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export class CustomerDirectoryIdentityError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message);
    this.name = "CustomerDirectoryIdentityError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function text(value, maximum, field = "Customer detail") {
  const normalized = String(value || "").trim();
  if (normalized.length > maximum) {
    throw new CustomerDirectoryIdentityError(
      "CUSTOMER_DIRECTORY_INPUT_INVALID",
      `${field} must be ${maximum} characters or less.`,
      400,
    );
  }
  return normalized || null;
}

function normalizedExactName(value) {
  return text(value, 300)?.toLocaleLowerCase("en-US") || null;
}

async function selectedIdentity(input, db) {
  const selected = await db.query(
    "select * from customer_directory_customers where company_id=$1 and id=$2",
    [input.companyId, input.customerId],
  );
  const existingCustomer = selected.rows[0];
  if (!existingCustomer) {
    throw new CustomerDirectoryIdentityError(
      "CUSTOMER_DIRECTORY_SELECTION_INVALID",
      "The selected customer is unavailable. Refresh the customer list and try again.",
    );
  }
  let existingContact = null;
  if (input.contactId) {
    existingContact = (await db.query(
      `select * from customer_directory_contacts
        where company_id=$1 and customer_id=$2 and id=$3`,
      [input.companyId, existingCustomer.id, input.contactId],
    )).rows[0];
    if (!existingContact) {
      throw new CustomerDirectoryIdentityError(
        "CUSTOMER_DIRECTORY_CONTACT_SELECTION_INVALID",
        "The selected customer contact is unavailable. Refresh the customer list and try again.",
      );
    }
  }
  return { customer: existingCustomer, contact: existingContact };
}

/**
 * Resolves the directory identity captured by a Workorder inside its creation
 * transaction. Selected IDs are authoritative. A typed, unmatched customer is
 * serialized by tenant and normalized exact name so retries and concurrent
 * Workorders reuse one directory identity.
 */
export async function resolveWorkorderCustomerIdentity(input, db = { query }) {
  const formData = input.formData && typeof input.formData === "object" ? input.formData : {};
  const selectedCustomerId = text(formData.customerAccountId, 100, "Customer selection");
  const selectedContactId = text(formData.customerContactId, 100, "Customer contact selection");
  const typedName = text(formData.customerCompanyName || formData.companyName, 300, "Customer name");
  let resolved;

  if (!selectedCustomerId && selectedContactId) {
    throw new CustomerDirectoryIdentityError(
      "CUSTOMER_DIRECTORY_CONTACT_SELECTION_INVALID",
      "Select a customer before selecting a customer contact.",
    );
  }
  if (selectedCustomerId) {
    if (!DATABASE_UUID_PATTERN.test(selectedCustomerId)
      || (selectedContactId && !DATABASE_UUID_PATTERN.test(selectedContactId))) {
      throw new CustomerDirectoryIdentityError(
        "CUSTOMER_DIRECTORY_SELECTION_INVALID",
        "The selected customer is unavailable. Refresh the customer list and try again.",
      );
    }
    resolved = await selectedIdentity({
      companyId: input.companyId,
      customerId: selectedCustomerId,
      contactId: selectedContactId,
    }, db);
  } else {
    if (!typedName) return { formData };
    const normalizedName = normalizedExactName(typedName);
    await db.query(
      "select pg_advisory_xact_lock(hashtext($1),hashtext($2))",
      [String(input.companyId), normalizedName],
    );
    let existingCustomer = (await db.query(
      `select * from customer_directory_customers
        where company_id=$1
          and lower(name)=$2
        order by created_at,id limit 1`,
      [input.companyId, normalizedName],
    )).rows[0];
    const address = text(formData.customerAddress, 1000, "Customer address");
    if (!existingCustomer) {
      existingCustomer = (await db.query(
        `insert into customer_directory_customers(
           company_id,name,address,created_by_user_id,updated_by_user_id
         ) values($1,$2,$3,$4,$4) returning *`,
        [input.companyId, typedName, address, input.actorId],
      )).rows[0];
    } else if (!existingCustomer.address && address) {
      existingCustomer = (await db.query(
        `update customer_directory_customers
            set address=$3,version=version+1,updated_by_user_id=$4,updated_at=now()
          where company_id=$1 and id=$2 returning *`,
        [input.companyId, existingCustomer.id, address, input.actorId],
      )).rows[0];
    }

    const contactName = text(formData.customerContactName, 300, "Customer contact name");
    const contactEmail = text(formData.customerContactEmail, 320, "Customer contact email");
    const contactPhone = text(formData.customerContactPhone, 100, "Customer contact phone");
    let existingContact = null;
    if (contactName || contactEmail) {
      const storedContactName = contactName || contactEmail;
      const normalizedContactName = normalizedExactName(storedContactName);
      existingContact = (await db.query(
        `select * from customer_directory_contacts
          where company_id=$1 and customer_id=$2
            and (lower(name)=$3
              or ($4::text is not null and lower(btrim(email))=lower($4)))
          order by (lower(name)=$3) desc,created_at,id limit 1`,
        [input.companyId, existingCustomer.id, normalizedContactName, contactEmail],
      )).rows[0];
      if (!existingContact) {
        existingContact = (await db.query(
          `insert into customer_directory_contacts(
             company_id,customer_id,name,email,phone,created_by_user_id,updated_by_user_id
           ) values($1,$2,$3,$4,$5,$6,$6) returning *`,
          [input.companyId, existingCustomer.id, storedContactName, contactEmail, contactPhone, input.actorId],
        )).rows[0];
      } else if ((!existingContact.email && contactEmail) || (!existingContact.phone && contactPhone)) {
        existingContact = (await db.query(
          `update customer_directory_contacts
              set email=coalesce(email,$4),phone=coalesce(phone,$5),version=version+1,
                  updated_by_user_id=$6,updated_at=now()
            where company_id=$1 and customer_id=$2 and id=$3 returning *`,
          [input.companyId, existingCustomer.id, existingContact.id, contactEmail, contactPhone, input.actorId],
        )).rows[0];
      }
    }
    resolved = { customer: existingCustomer, contact: existingContact };
  }

  const resolvedCustomer = customer(resolved.customer);
  const resolvedContact = contact(resolved.contact);
  return {
    customer: resolvedCustomer,
    contact: resolvedContact,
    formData: {
      ...formData,
      customerAccountId: resolvedCustomer.id,
      customerContactId: resolvedContact?.id || "",
      customerCompanyName: resolvedCustomer.name,
      customerAddress: resolvedCustomer.address || "",
      customerContactName: resolvedContact?.name || "",
      customerContactEmail: resolvedContact?.email || "",
      customerContactPhone: resolvedContact?.phone || "",
    },
  };
}

export async function listCustomers({ companyId }, db = { query }) {
  const result = await db.query(
    `select customer.*,
            coalesce(contact_summary.contacts,'[]'::jsonb) as contacts,
            coalesce(contact_summary.contact_count,0)::integer as contact_count
       from customer_directory_customers customer
       left join lateral (
         select jsonb_agg(to_jsonb(contact) order by lower(contact.name),contact.id) as contacts,
                count(*)::integer as contact_count
           from customer_directory_contacts contact
          where contact.company_id=customer.company_id and contact.customer_id=customer.id
       ) contact_summary on true
      where customer.company_id=$1
      order by lower(customer.name),customer.id
      limit 500`,
    [companyId],
  );
  return result.rows.map(customer);
}

export async function createCustomer(input, db = { query }) {
  const result = await db.query(
    `insert into customer_directory_customers(company_id,name,address,created_by_user_id,updated_by_user_id)
     values($1,$2,$3,$4,$4) returning *`,
    [input.companyId, input.name, input.address ?? null, input.actorId],
  );
  return customer(result.rows[0]);
}

export async function updateCustomer(input, db = { query }) {
  const result = await db.query(
    `update customer_directory_customers set name=$4,address=$5,version=version+1,
      updated_by_user_id=$6,updated_at=now()
     where company_id=$1 and id=$2 and version=$3 returning *`,
    [input.companyId, input.customerId, input.version, input.name, input.address ?? null, input.actorId],
  );
  return customer(result.rows[0]);
}

export async function listCustomerContacts({ companyId, customerId }, db = { query }) {
  const result = await db.query(
    `select contact.* from customer_directory_contacts contact
       join customer_directory_customers customer on customer.company_id=contact.company_id
        and customer.id=contact.customer_id
      where contact.company_id=$1 and contact.customer_id=$2 order by lower(contact.name),contact.id limit 500`,
    [companyId, customerId],
  );
  return result.rows.map(contact);
}

export async function createCustomerContact(input, db = { query }) {
  const result = await db.query(
    `insert into customer_directory_contacts(company_id,customer_id,name,email,phone,created_by_user_id,updated_by_user_id)
     select customer.company_id,customer.id,$3,$4,$5,$6,$6
       from customer_directory_customers customer where customer.company_id=$1 and customer.id=$2 returning *`,
    [input.companyId, input.customerId, input.name, input.email ?? null, input.phone ?? null, input.actorId],
  );
  return contact(result.rows[0]);
}

export async function updateCustomerContact(input, db = { query }) {
  const result = await db.query(
    `update customer_directory_contacts set name=$5,email=$6,phone=$7,version=version+1,
      updated_by_user_id=$8,updated_at=now()
     where company_id=$1 and customer_id=$2 and id=$3 and version=$4 returning *`,
    [input.companyId, input.customerId, input.contactId, input.version,
      input.name, input.email ?? null, input.phone ?? null, input.actorId],
  );
  return contact(result.rows[0]);
}
