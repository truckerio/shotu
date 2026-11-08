import { createHash, createHmac, randomBytes } from "node:crypto";
import { getPool } from "../pool.js";
import {
  createCustomerDocumentGrant,
  viewCustomerDocumentGrant,
  recordCustomerDocumentResponse,
} from "./customer-documents.repo.js";
import { readCustomerPortalDocument } from "../../modules/customer-documents/customer-documents.service.js";
export const repairHash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const unavailable = () =>
  Object.assign(new Error("Customer repair link unavailable"), {
    code: "CUSTOMER_REPAIR_UNAVAILABLE",
  });
const conflict = () =>
  Object.assign(new Error("Repair request conflicts with current record"), {
    code: "CUSTOMER_REPAIR_CONFLICT",
  });
async function transaction(deps, fn) {
  if (deps.client) return fn(deps.client);
  const client = await (deps.pool || getPool()).connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
function grantView(row) {
  return {
    id: row.id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at || null,
  };
}
export async function createRepairGrant(input, deps = {}) {
  return transaction(deps, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `repair-create:${input.companyId}:${input.actorId}:${input.idempotencyKey}`,
    ]);
    const prior = (
      await client.query(
        "select * from customer_repair_access_grants where company_id=$1 and issued_by_user_id=$2 and idempotency_key=$3",
        [input.companyId, input.actorId, input.idempotencyKey],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== input.requestHash) throw conflict();
      return { grant: grantView(prior), rawToken: null, replayed: true };
    }
    const token = randomBytes(32).toString("base64url");
    const row = (
      await client.query(
        `insert into customer_repair_access_grants(company_id,location_id,workorder_id,token_hash,token_hint,issued_by_user_id,expires_at,idempotency_key,request_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [
          input.companyId,
          input.locationId,
          input.workorderId,
          repairHash(token),
          token.slice(-8),
          input.actorId,
          input.expiresAt,
          input.idempotencyKey,
          input.requestHash,
        ],
      )
    ).rows[0];
    return { grant: grantView(row), rawToken: token, replayed: false };
  });
}
export async function revokeRepairGrant(input, deps = {}) {
  return transaction(deps, async (client) => {
    const grant = (
      await client.query(
        "select * from customer_repair_access_grants where company_id=$1 and location_id=$2 and workorder_id=$3 and id=$4 for update",
        [input.companyId, input.locationId, input.workorderId, input.grantId],
      )
    ).rows[0];
    if (!grant) throw unavailable();
    await client.query(
      "update customer_repair_access_grants set revoked_at=coalesce(revoked_at,now()),revoked_by_user_id=coalesce(revoked_by_user_id,$2) where id=$1",
      [grant.id, input.actorId],
    );
    await client.query(
      `update customer_document_access_grants set revoked_at=coalesce(revoked_at,now()),revoked_by_user_id=coalesce(revoked_by_user_id,$2),revocation_reason=coalesce(revocation_reason,'Repair link revoked') where id in(select revision_grant_id from customer_repair_revision_grants where repair_grant_id=$1)`,
      [grant.id, input.actorId],
    );
    return { revoked: true };
  });
}
async function lockRepair(client, rawToken) {
  const grant = (
    await client.query(
      "select * from customer_repair_access_grants where token_hash=$1 for update",
      [repairHash(rawToken)],
    )
  ).rows[0];
  if (
    !grant ||
    grant.revoked_at ||
    new Date(grant.expires_at).getTime() <= Date.now()
  )
    throw unavailable();
  // Revision insertion and voiding lock the same document identity. Holding these
  // locks across response delegation prevents a stale approval winning a race.
  await client.query(
    "select id from customer_documents where company_id=$1 and location_id=$2 and workorder_id=$3 order by id for update",
    [grant.company_id, grant.location_id, grant.workorder_id],
  );
  const workorder = (
    await client.query(
      "select id,status,updated_at,form_data from operational_workorders where company_id=$1 and location_id=$2 and id=$3 for share",
      [grant.company_id, grant.location_id, grant.workorder_id],
    )
  ).rows[0];
  if (!workorder) throw unavailable();
  return { grant, workorder };
}
async function revisions(client, scope) {
  return (
    await client.query(
      `select r.*,d.document_type,d.document_number from customer_documents d join customer_document_revisions r on r.company_id=d.company_id and r.document_id=d.id where d.company_id=$1 and d.location_id=$2 and d.workorder_id=$3 order by r.issued_at desc,r.revision_number desc,r.id desc`,
      [scope.company_id, scope.location_id, scope.workorder_id],
    )
  ).rows;
}
async function childGrant(client, parent, rawToken, revision) {
  const token = createHmac("sha256", rawToken)
    .update(`customer-repair-revision:${revision.id}`)
    .digest("base64url");
  const command = {
    companyId: parent.company_id,
    locationId: parent.location_id,
    revisionId: revision.id,
    actorId: parent.issued_by_user_id,
    expiresAt: new Date(parent.expires_at).toISOString(),
    idempotencyKey: `repair:${parent.id}:${revision.id}`,
  };
  const result = await createCustomerDocumentGrant(
    { ...command, requestHash: repairHash(command) },
    { client, tokenFactory: () => token },
  );
  await client.query(
    "insert into customer_repair_revision_grants(repair_grant_id,revision_grant_id) values($1,$2) on conflict do nothing",
    [parent.id, result.grant.id],
  );
  return token;
}
export async function readRepairPortal(input, deps = {}) {
  return transaction(deps, async (client) => {
    const { grant, workorder } = await lockRepair(client, input.rawToken);
    const rows = await revisions(client, grant);
    const documents = { estimate: null, invoice: null };
    for (const type of ["estimate", "invoice"]) {
      const revision = rows.find((row) => row.document_type === type);
      if (!revision) continue;
      const child = await childGrant(client, grant, input.rawToken, revision);
      const result = await readCustomerPortalDocument(
        child,
        { idempotencyKey: `repair-view:${grant.id}:${revision.id}` },
        {
          readGrant: (command) =>
            viewCustomerDocumentGrant(command, { client }),
        },
      );
      documents[type] = {
        revisionId: revision.id,
        documentId: revision.document_id,
        ...result,
        canRespond: result.grant.responseEligible === true,
        response: result.document.response,
      };
    }
    await client.query(
      "update customer_repair_access_grants set last_used_at=now() where id=$1",
      [grant.id],
    );
    return {
      workorder: {
        id: workorder.id,
        status: workorder.status,
        updatedAt: workorder.updated_at,
        unit: documents.estimate?.document?.unit ||
          documents.invoice?.document?.unit || {
            label: String(workorder.form_data?.unitNumber || "Vehicle"),
          },
      },
      documents,
      history: rows.map((row) => ({
        revisionId: row.id,
        documentId: row.document_id,
        type: row.document_type,
        number: row.document_number,
        revision: row.revision_number,
        issuedAt: row.issued_at,
        total: row.total_amount,
        currency: row.currency,
      })),
      grant: grantView(grant),
    };
  });
}
export async function respondRepairPortal(input, deps = {}) {
  return transaction(deps, async (client) => {
    const { grant } = await lockRepair(client, input.rawToken);
    const rows = await revisions(client, grant);
    const current = rows.find((row) => row.document_type === "estimate");
    if (!current || current.id !== input.revisionId) throw conflict();
    const child = await childGrant(client, grant, input.rawToken, current);
    const command = {
      rawToken: child,
      responseType: input.response,
      customerName: input.customerName,
      note: input.note || "",
      idempotencyKey: input.idempotencyKey,
    };
    return recordCustomerDocumentResponse(
      { ...command, requestHash: repairHash(command) },
      { client },
    );
  });
}
function messageView(row) {
  return {
    id: row.id,
    senderRole: row.sender_role,
    senderName: row.customer_sender_name || row.sender_name || "Shop team",
    body: row.body,
    createdAt: row.created_at,
    audience: "customer",
    messageType: "normal",
    attachment: null,
  };
}
async function listMessages(client, workorderId) {
  return (
    await client.query(
      `select m.id,m.sender_role,m.customer_sender_name,m.body,m.created_at,u.display_name sender_name from chat_messages m left join user_profiles u on u.id=m.sender_user_id where m.workorder_id=$1 and m.audience='customer' order by m.created_at,m.id`,
      [workorderId],
    )
  ).rows.map(messageView);
}
async function appendMessage(client, scope, revision, input, childId = null) {
  const customer = Boolean(childId);
  const key = `repair:${customer ? scope.id : input.actorId}:${input.idempotencyKey}`;
  const requestHash = repairHash({
    body: input.body,
    customerName: customer ? input.customerName : null,
  });
  const row = (
    await client.query(
      `insert into chat_messages(workorder_id,sender_user_id,sender_role,message_type,body,dedupe_key,audience,customer_document_id,customer_document_revision_id,customer_document_access_grant_id,customer_sender_name,customer_request_hash) values($1,$2,$3,'normal',$4,$5,'customer',$6,$7,$8,$9,$10) on conflict(workorder_id,dedupe_key) where dedupe_key is not null do nothing returning *`,
      [
        scope.workorder_id,
        customer ? null : input.actorId,
        customer ? "customer" : input.actorRole,
        input.body,
        key,
        revision.document_id,
        revision.id,
        childId,
        customer ? input.customerName : null,
        requestHash,
      ],
    )
  ).rows[0];
  if (row) return { message: messageView(row), replayed: false };
  const prior = (
    await client.query(
      "select * from chat_messages where workorder_id=$1 and dedupe_key=$2 and audience='customer'",
      [scope.workorder_id, key],
    )
  ).rows[0];
  if (!prior || prior.customer_request_hash !== requestHash) throw conflict();
  return { message: messageView(prior), replayed: true };
}
export async function readRepairChat(input, deps = {}) {
  return transaction(deps, async (client) => {
    const { grant } = await lockRepair(client, input.rawToken);
    return { messages: await listMessages(client, grant.workorder_id) };
  });
}
export async function sendRepairChat(input, deps = {}) {
  return transaction(deps, async (client) => {
    const { grant } = await lockRepair(client, input.rawToken);
    const revision = (await revisions(client, grant))[0];
    if (!revision) throw conflict();
    const token = await childGrant(client, grant, input.rawToken, revision);
    const child = (
      await client.query(
        "select id from customer_document_access_grants where token_hash=$1",
        [repairHash(token)],
      )
    ).rows[0];
    return appendMessage(client, grant, revision, input, child.id);
  });
}
export async function readRepairStaffChat(input, deps = {}) {
  return transaction(deps, (client) =>
    listMessages(client, input.workorderId).then((messages) => ({ messages })),
  );
}
export async function sendRepairStaffChat(input, deps = {}) {
  return transaction(deps, async (client) => {
    const scope = {
      company_id: input.companyId,
      location_id: input.locationId,
      workorder_id: input.workorderId,
    };
    const revision = (await revisions(client, scope))[0];
    if (!revision) throw conflict();
    return appendMessage(client, scope, revision, input);
  });
}
