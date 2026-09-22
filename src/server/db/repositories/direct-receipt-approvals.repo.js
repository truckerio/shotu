import { randomUUID } from "node:crypto";
import { getPool } from "../pool.js";
import { readApprovalPolicy, canApprovePurchase } from "./purchase-approval-settings.repo.js";

function publicRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    locationId: row.location_id,
    catalogPartId: row.catalog_part_id,
    targetPositionId: row.target_position_id || null,
    submittedBy: row.submitted_by,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    originalCommand: row.original_command,
    receiverEvidence: row.receiver_evidence,
    status: row.status,
    receiptId: row.receipt_id || null,
    decisionBy: row.decision_by || null,
    decisionReason: row.decision_reason || "",
    decidedAt: row.decided_at || null,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicDetail(row) {
  if (!row) return null;
  const command = row.original_command || {};
  return {
    approvalRequest: publicRequest(row),
    part: {
      id: row.catalog_part_id,
      partNumber: row.part_number || "Part",
      description: row.part_description || "",
    },
    location: { id: row.location_id, name: row.location_name || "Shop" },
    destination: row.target_position_id ? {
      id: row.target_position_id,
      code: row.position_code || "",
      name: row.position_name || "Storage position",
      path: [row.position_code, row.position_name].filter(Boolean).join(" · "),
    } : null,
    arrival: {
      quantity: command.quantity,
      uomCode: command.uomCode || row.uom_code || "",
      trackingMode: command.trackingMode || row.tracking_mode || null,
      disposition: command.disposition || "accepted",
      holdLocation: command.holdLocation || "",
      damageDetails: command.damageDetails || "",
      reference: command.reference || "",
      noPurchaseOrderReason: command.noPurchaseOrderReason || "",
      unitCost: command.unitCost ?? null,
      totalCost: command.totalCost ?? null,
      serialNumbers: Array.isArray(command.serialNumbers) ? command.serialNumbers : [],
    },
    submitter: { id: row.submitted_by, displayName: row.submitter_name || "Team member" },
    evidence: {
      confirmation: row.receiver_evidence?.confirmation || command.confirmation || "",
      submittedAt: row.created_at,
    },
  };
}

const scoped = `company_id=any($1::uuid[]) and ($3::boolean or location_id=any($2::uuid[]))`;

export async function findDirectReceiptApprovalOutcome({ companyIds, locationIds, isAdmin, actorId, idempotencyKey }) {
  const client = await getPool().connect();
  try {
    const result = await client.query(`select * from inventory_direct_receipt_approval_requests
      where ${scoped} and submitted_by=$4 and idempotency_key=$5 limit 1`,
    [companyIds, locationIds, isAdmin, actorId, idempotencyKey]);
    return publicRequest(result.rows[0]);
  } finally { client.release(); }
}

export async function createDirectReceiptApprovalRequest({
  companyIds, locationIds, isAdmin, actorId, locationId, catalogPartId, targetPositionId,
  idempotencyKey, requestHash, originalCommand, receiverEvidence, partVersion, trackingMode, uomCode, serialNumbers,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const location = (await client.query(`select id,company_id from locations where id=$1 and company_id=any($2::uuid[])
      and ($4::boolean or id=any($3::uuid[])) and active limit 1 for key share`, [locationId, companyIds, locationIds, isAdmin])).rows[0];
    if (!location) { await client.query("rollback"); return { kind: "not_found" }; }
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`direct-receipt-approval:${location.company_id}:${actorId}:${idempotencyKey}`]);
    const existing = (await client.query(`select * from inventory_direct_receipt_approval_requests
      where company_id=$1 and submitted_by=$2 and idempotency_key=$3 limit 1`, [location.company_id, actorId, idempotencyKey])).rows[0];
    if (existing) {
      await client.query("commit");
      return existing.request_hash === requestHash ? { kind: "replay", request: publicRequest(existing) } : { kind: "conflict" };
    }
    const policy = await readApprovalPolicy(client, location.company_id, true);
    if (!policy || await canApprovePurchase(client, location.company_id, actorId, policy)) {
      await client.query("rollback");
      return { kind: "not_required" };
    }
    const part = (await client.query(`select id,version,tracking_mode,uom_code from parts_catalog
      where company_id=$1 and id=$2 limit 1 for key share`, [location.company_id, catalogPartId])).rows[0];
    if (!part || Number(part.version)!==Number(partVersion) || part.tracking_mode!==trackingMode || part.uom_code!==uomCode) {
      await client.query("rollback"); return { kind: "catalog_changed" };
    }
    if (targetPositionId) {
      const target = (await client.query(`select id from inventory_positions where company_id=$1 and location_id=$2 and id=$3
        and is_active and can_store and is_pickable and usage='storage' and system_key is null limit 1 for key share`,
      [location.company_id, locationId, targetPositionId])).rows[0];
      if (!target) { await client.query("rollback"); return { kind: "target_position_invalid" }; }
    }
    if (serialNumbers.length) {
      const duplicate = await client.query(`select 1 from inventory_serialized_units where company_id=$1
        and upper(btrim(serial_number))=any($2::text[]) limit 1 for key share`,
      [location.company_id, serialNumbers.map((value) => value.trim().toUpperCase())]);
      if (duplicate.rows[0]) { await client.query("rollback"); return { kind: "serial_conflict" }; }
    }
    const id = randomUUID();
    const row = (await client.query(`insert into inventory_direct_receipt_approval_requests
      (id,company_id,location_id,catalog_part_id,target_position_id,submitted_by,idempotency_key,request_hash,original_command,receiver_evidence)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [id, location.company_id, locationId, catalogPartId, targetPositionId || null, actorId, idempotencyKey, requestHash,
      JSON.stringify(originalCommand), JSON.stringify(receiverEvidence)])).rows[0];
    await client.query(`insert into inventory_direct_receipt_approval_events(company_id,request_id,actor_id,action,details)
      values($1,$2,$3,'submit',$4)`, [location.company_id, id, actorId, JSON.stringify({ requestHash })]);
    await client.query("commit");
    return { kind: "pending", request: publicRequest(row) };
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; }
  finally { client.release(); }
}

export async function loadDirectReceiptApprovalRequest({ requestId, companyIds, locationIds, isAdmin }) {
  const client = await getPool().connect();
  try {
    const result = await client.query(`select * from inventory_direct_receipt_approval_requests where ${scoped} and id=$4 limit 1`,
    [companyIds, locationIds, isAdmin, requestId]);
    return publicRequest(result.rows[0]);
  } finally { client.release(); }
}

export async function readDirectReceiptApprovalDetail({ requestId, companyIds, locationIds, isAdmin, actorId }) {
  const client = await getPool().connect();
  try {
    const result = await client.query(`select request.*,part.part_number,part.description part_description,
        part.uom_code,part.tracking_mode,location.name location_name,position.code position_code,
        position.name position_name,submitter.display_name submitter_name
      from inventory_direct_receipt_approval_requests request
      join parts_catalog part on part.company_id=request.company_id and part.id=request.catalog_part_id
      join locations location on location.company_id=request.company_id and location.id=request.location_id
      left join inventory_positions position on position.company_id=request.company_id and position.id=request.target_position_id
      left join user_profiles submitter on submitter.id=request.submitted_by
      where request.company_id=any($1::uuid[]) and ($3::boolean or request.location_id=any($2::uuid[]))
        and request.id=$4 limit 1`, [companyIds, locationIds, isAdmin, requestId]);
    const row = result.rows[0];
    if (!row) return { kind: "not_found" };
    const policy = await readApprovalPolicy(client, row.company_id, true);
    if (!policy || !(await canApprovePurchase(client, row.company_id, actorId, policy))) return { kind: "forbidden" };
    return { kind: "found", detail: publicDetail(row) };
  } finally { client.release(); }
}

export async function closeDirectReceiptApprovalRequest({ requestId, companyIds, locationIds, isAdmin, actorId, expectedVersion, action, reason }) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const row = (await client.query(`select * from inventory_direct_receipt_approval_requests where ${scoped} and id=$4 limit 1 for update`,
    [companyIds, locationIds, isAdmin, requestId])).rows[0];
    if (!row) { await client.query("rollback"); return { kind: "not_found" }; }
    if (row.status !== "pending" || Number(row.version)!==Number(expectedVersion)) { await client.query("rollback"); return { kind: "stale" }; }
    const policy = await readApprovalPolicy(client, row.company_id, true);
    const approver = policy && await canApprovePurchase(client, row.company_id, actorId, policy);
    if ((action === "reject" && !approver) || (action === "cancel" && row.submitted_by !== actorId && !approver)) {
      await client.query("rollback"); return { kind: "forbidden" };
    }
    const updated = (await client.query(`update inventory_direct_receipt_approval_requests set status=$3,decision_by=$4,
      decision_reason=$5,decided_at=now(),version=version+1,updated_at=now() where company_id=$1 and id=$2 returning *`,
    [row.company_id, row.id, action === "reject" ? "rejected" : "cancelled", actorId, reason])).rows[0];
    await client.query(`insert into inventory_direct_receipt_approval_events(company_id,request_id,actor_id,action,details)
      values($1,$2,$3,$4,$5)`, [row.company_id,row.id,actorId,action,JSON.stringify({ reason })]);
    await client.query("commit");
    return { kind: "closed", request: publicRequest(updated) };
  } catch(error) { await client.query("rollback").catch(()=>{}); throw error; }
  finally { client.release(); }
}

export const directReceiptApprovalInternals = Object.freeze({ publicRequest, publicDetail });
