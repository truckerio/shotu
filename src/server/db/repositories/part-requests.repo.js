import { getPool, query } from "../pool.js";
import { PART_APPROVAL_STATUS, normalizePartNumber } from "../../modules/parts/part.constants.js";
import { WORKORDER_STATUS } from "../../modules/workorders/workorder.constants.js";

const TERMINAL_WORKORDER_STATUSES = [WORKORDER_STATUS.MECHANIC_DONE, WORKORDER_STATUS.CLOSED, WORKORDER_STATUS.ODOO_ENTERED, WORKORDER_STATUS.CANCELLED];

function publicAllocation(row) {
  return {
    id: row.id,
    sourceType: row.source_type,
    status: row.status,
    quantity: row.quantity,
    locationId: row.location_id,
    locationName: row.location_name || "",
    inventoryItemId: row.inventory_item_id,
    vendor: row.vendor,
    sourceReference: row.source_reference,
    unitPrice: row.unit_price === null ? null : Number(row.unit_price),
    quoteUrl: row.quote_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicInventory(row) {
  return {
    id: row.id,
    locationId: row.location_id,
    locationName: row.location_name || "",
    partNumber: row.part_number,
    quantityOnHand: row.quantity_on_hand,
    quantityReserved: row.quantity_reserved,
    quantityAvailable: row.quantity_on_hand - row.quantity_reserved,
    binLocation: row.bin_location,
    updatedAt: row.updated_at,
  };
}

function publicRequest(row) {
  return {
    id: row.id,
    workorderId: row.workorder_id,
    requestedByUserId: row.requested_by_user_id,
    requestedByName: row.requested_by_name || "",
    rawQuery: row.raw_query,
    partNumber: row.part_number,
    manufacturer: row.manufacturer,
    description: row.description,
    category: row.category,
    quantity: row.quantity,
    repairOrder: row.repair_order,
    approvalStatus: row.approval_status,
    fitmentStatus: row.fitment_status,
    fitmentNotes: row.fitment_notes,
    usageStatus: row.usage_status,
    approvedByName: row.approved_by_name || "",
    approvedAt: row.approved_at,
    decisionReason: row.decision_reason,
    sourceChatMessageId: row.source_chat_message_id,
    sourceAttachmentId: row.source_attachment_id,
    rawContext: row.raw_context || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    allocations: (row.allocations || []).map(publicAllocation),
    inventory: (row.inventory || []).map(publicInventory),
  };
}

export async function listWorkorderPartRequests(workorderId) {
  const result = await query(
    `
      select
        pr.*,
        requester.name as requested_by_name,
        approver.name as approved_by_name,
        coalesce((
          select jsonb_agg(to_jsonb(allocation_row) order by allocation_row.created_at)
          from (
            select pa.*, l.name as location_name
            from part_allocations pa
            left join locations l on l.id = pa.location_id
            where pa.part_request_id = pr.id
          ) allocation_row
        ), '[]'::jsonb) as allocations,
        coalesce((
          select jsonb_agg(to_jsonb(inventory_row) order by inventory_row.location_name, inventory_row.bin_location)
          from (
            select ii.*, l.name as location_name
            from inventory_items ii
            left join locations l on l.id = ii.location_id
            where ii.company_id = wo.company_id
              and ii.normalized_part_number = pr.normalized_part_number
              and pr.normalized_part_number <> ''
          ) inventory_row
        ), '[]'::jsonb) as inventory
      from workorder_part_requests pr
      join operational_workorders wo on wo.id = pr.workorder_id
      left join app_users requester on requester.id = pr.requested_by_user_id
      left join app_users approver on approver.id = pr.approved_by_user_id
      where pr.workorder_id = $1
      order by pr.created_at asc
    `,
    [workorderId]
  );
  return result.rows.map(publicRequest);
}

async function addPartEvent(client, { workorderId, partRequestId, eventType, actorUserId, note, metadata = {} }) {
  await client.query(
    `insert into part_request_events (workorder_id, part_request_id, event_type, actor_user_id, note, metadata)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [workorderId, partRequestId, eventType, actorUserId || null, note || "", JSON.stringify(metadata)]
  );
}

async function addSystemMessage(client, workorderId, body) {
  await client.query(
    `insert into chat_messages (workorder_id, sender_role, message_type, body)
     values ($1, 'system', 'system', $2)`,
    [workorderId, body]
  );
}

async function setWorkorderStatus(client, { workorderId, fromStatus, toStatus, actorUserId, note }) {
  if (!toStatus || fromStatus === toStatus) return;
  await client.query("update operational_workorders set status = $2, updated_at = now() where id = $1", [workorderId, toStatus]);
  await client.query(
    `insert into workorder_status_events (workorder_id, from_status, to_status, changed_by_user_id, note)
     values ($1, $2, $3, $4, $5)`,
    [workorderId, fromStatus, toStatus, actorUserId || null, note || ""]
  );
}

export async function createPartRequest(workorderId, input) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query("select * from operational_workorders where id = $1 for update", [workorderId]);
    const workorder = current.rows[0];
    if (!workorder) throw new Error("Workorder not found.");
    const assignment = await client.query(
      `select 1 from workorder_mechanic_assignments
       where workorder_id = $1 and mechanic_user_id = $2 and active = true`,
      [workorderId, input.mechanicUserId],
    );
    if (!assignment.rows[0]) throw new Error("Only an assigned mechanic can request parts.");
    if (TERMINAL_WORKORDER_STATUSES.includes(workorder.status)) throw new Error("Parts cannot be requested on a completed workorder.");

    if (input.sourceChatMessageId) {
      const existing = await client.query(
        "select id from workorder_part_requests where source_chat_message_id = $1 limit 1",
        [input.sourceChatMessageId]
      );
      if (existing.rows[0]) {
        await client.query("commit");
        return (await listWorkorderPartRequests(workorderId)).find((request) => request.id === existing.rows[0].id);
      }
    }

    const partNumber = input.partNumber || "";
    const inserted = await client.query(
      `
        insert into workorder_part_requests (
          workorder_id, requested_by_user_id, raw_query, part_number, normalized_part_number,
          manufacturer, description, category, quantity, repair_order, fitment_status,
          fitment_notes, resume_workorder_status, source_chat_message_id,
          source_attachment_id, raw_context
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
        returning id
      `,
      [
        workorderId,
        input.mechanicUserId,
        input.query,
        partNumber,
        normalizePartNumber(partNumber),
        input.manufacturer || "",
        input.description || input.query,
        input.category || "",
        input.quantity,
        input.repairOrder || "",
        input.fitmentStatus || "unknown",
        input.fitmentNotes || "",
        workorder.status === WORKORDER_STATUS.PARTS_REQUESTED ? null : workorder.status,
        input.sourceChatMessageId || null,
        input.sourceAttachmentId || null,
        JSON.stringify(input.rawContext || {}),
      ]
    );
    const requestId = inserted.rows[0].id;
    await addPartEvent(client, {
      workorderId,
      partRequestId: requestId,
      eventType: "submitted",
      actorUserId: input.mechanicUserId,
      note: `Requested ${input.quantity} x ${partNumber || input.description || input.query}.`,
    });
    await addSystemMessage(client, workorderId, `Part request submitted: ${input.quantity} x ${partNumber || input.description || input.query}.`);
    await setWorkorderStatus(client, {
      workorderId,
      fromStatus: workorder.status,
      toStatus: WORKORDER_STATUS.PARTS_REQUESTED,
      actorUserId: input.mechanicUserId,
      note: "Mechanic submitted a structured part request.",
    });
    await client.query("commit");
    return (await listWorkorderPartRequests(workorderId)).find((request) => request.id === requestId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createApprovedOfficePart(workorderId, input, actorUserId) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query("select * from operational_workorders where id = $1 for update", [workorderId]);
    const workorder = current.rows[0];
    if (!workorder) throw new Error("Workorder not found.");
    if (TERMINAL_WORKORDER_STATUSES.includes(workorder.status)) throw new Error("Parts cannot be added to a completed workorder.");
    const values = {
      partNumber: input.partNumber || "",
      manufacturer: input.manufacturer || "",
      description: input.description || input.query,
      category: input.category || "",
      quantity: input.quantity,
      repairOrder: input.repairOrder || "",
    };
    const catalogPartId = await upsertCatalogPart(client, workorder.company_id, values);
    const inserted = await client.query(
      `
        insert into workorder_part_requests (
          workorder_id, requested_by_user_id, catalog_part_id, raw_query, part_number,
          normalized_part_number, manufacturer, description, category, quantity,
          repair_order, approval_status, fitment_status, fitment_notes,
          approved_by_user_id, approved_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'approved', $12, $13, $2, now())
        returning id
      `,
      [
        workorderId,
        actorUserId,
        catalogPartId,
        input.query,
        values.partNumber,
        normalizePartNumber(values.partNumber),
        values.manufacturer,
        values.description,
        values.category,
        values.quantity,
        values.repairOrder,
        input.fitmentStatus || "unknown",
        input.fitmentNotes || "",
      ]
    );
    const requestId = inserted.rows[0].id;
    const allocations = input.allocations.length ? input.allocations : [{ sourceType: "unknown", status: "proposed", quantity: values.quantity }];
    for (const allocation of allocations) {
      await createAllocation(client, {
        requestId,
        workorder,
        actorUserId,
        allocation,
        normalizedPartNumber: normalizePartNumber(values.partNumber),
      });
    }
    await projectApprovedParts(client, workorderId);
    const label = values.partNumber || values.description || input.query;
    await addPartEvent(client, {
      workorderId,
      partRequestId: requestId,
      eventType: "office_added",
      actorUserId,
      note: `Office added ${values.quantity} x ${label}.`,
      metadata: { allocations: allocations.length, fitmentStatus: input.fitmentStatus },
    });
    await addSystemMessage(client, workorderId, `Office added approved part: ${values.quantity} x ${label}.`);
    await client.query("commit");
    return (await listWorkorderPartRequests(workorderId)).find((request) => request.id === requestId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertCatalogPart(client, companyId, values) {
  const normalized = normalizePartNumber(values.partNumber);
  if (!normalized) return null;
  const result = await client.query(
    `
      insert into parts_catalog (
        company_id, normalized_part_number, part_number, manufacturer, description, category, repair_template
      ) values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (company_id, normalized_part_number) do update set
        part_number = excluded.part_number,
        manufacturer = excluded.manufacturer,
        description = excluded.description,
        category = excluded.category,
        repair_template = excluded.repair_template,
        updated_at = now()
      returning id
    `,
    [companyId, normalized, values.partNumber, values.manufacturer, values.description, values.category, values.repairOrder]
  );
  return result.rows[0].id;
}

async function createAllocation(client, { requestId, workorder, actorUserId, allocation, normalizedPartNumber }) {
  let inventoryItemId = allocation.inventoryItemId || null;
  if (allocation.sourceType === "inventory" && !inventoryItemId && normalizedPartNumber) {
    const match = await client.query(
      `select id from inventory_items
       where company_id = $1 and normalized_part_number = $2
         and ($3::uuid is null or location_id = $3)
       order by case when location_id = $3 then 0 else 1 end, updated_at desc
       limit 1 for update`,
      [workorder.company_id, normalizedPartNumber, allocation.locationId || workorder.location_id]
    );
    inventoryItemId = match.rows[0]?.id || null;
  }
  if (inventoryItemId && allocation.sourceType === "inventory" && allocation.status === "reserved") {
    const reserved = await client.query(
      `update inventory_items
       set quantity_reserved = quantity_reserved + $2, updated_at = now()
       where id = $1 and quantity_on_hand - quantity_reserved >= $2
       returning id`,
      [inventoryItemId, allocation.quantity]
    );
    if (!reserved.rows[0]) throw new Error("Not enough inventory is available to reserve this quantity.");
  }
  await client.query(
    `
      insert into part_allocations (
        part_request_id, source_type, status, quantity, location_id, inventory_item_id,
        vendor, source_reference, unit_price, quote_url, created_by_user_id
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      requestId,
      allocation.sourceType,
      allocation.status,
      allocation.quantity,
      allocation.locationId || workorder.location_id || null,
      inventoryItemId,
      allocation.vendor || "",
      allocation.sourceReference || "",
      allocation.unitPrice ?? null,
      allocation.quoteUrl || "",
      actorUserId || null,
    ]
  );
}

async function projectApprovedParts(client, workorderId) {
  const workorderResult = await client.query("select form_data from operational_workorders where id = $1 for update", [workorderId]);
  const formData = workorderResult.rows[0]?.form_data || {};
  const manualParts = (Array.isArray(formData.parts) ? formData.parts : [])
    .filter((part) => !part?.requestId)
    .filter((part) => part?.partNo || part?.qty || part?.repairOrder);
  const approved = await client.query(
    `select id, part_number, quantity, repair_order
     from workorder_part_requests
     where workorder_id = $1 and approval_status = 'approved'
     order by created_at asc`,
    [workorderId]
  );
  formData.parts = [
    ...manualParts,
    ...approved.rows.map((part) => ({
      requestId: part.id,
      partNo: part.part_number,
      qty: String(part.quantity),
      repairOrder: part.repair_order,
    })),
  ];
  await client.query("update operational_workorders set form_data = $2::jsonb, updated_at = now() where id = $1", [workorderId, JSON.stringify(formData)]);
}

async function restoreWorkorderWhenResolved(client, workorder, actorUserId) {
  const pending = await client.query(
    `select count(*)::int as count from workorder_part_requests
     where workorder_id = $1 and approval_status in ('submitted', 'needs_info')`,
    [workorder.id]
  );
  if (pending.rows[0].count || workorder.status !== WORKORDER_STATUS.PARTS_REQUESTED) return;
  const resume = await client.query(
    `select resume_workorder_status from workorder_part_requests
     where workorder_id = $1 and resume_workorder_status is not null
     order by created_at desc limit 1`,
    [workorder.id]
  );
  const nextStatus = resume.rows[0]?.resume_workorder_status
    || (workorder.current_mechanic_id ? WORKORDER_STATUS.IN_PROGRESS : WORKORDER_STATUS.OPEN);
  await setWorkorderStatus(client, {
    workorderId: workorder.id,
    fromStatus: workorder.status,
    toStatus: nextStatus,
    actorUserId,
    note: "All pending part requests were reviewed.",
  });
}

export async function decidePartRequest(workorderId, requestId, input, actorUserId) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `select pr.*, wo.company_id, wo.location_id, wo.current_mechanic_id, wo.status as workorder_status
       from workorder_part_requests pr
       join operational_workorders wo on wo.id = pr.workorder_id
       where pr.id = $1 and pr.workorder_id = $2
       for update`,
      [requestId, workorderId]
    );
    const request = result.rows[0];
    if (!request) throw new Error("Part request not found.");
    if (![PART_APPROVAL_STATUS.SUBMITTED, PART_APPROVAL_STATUS.NEEDS_INFO].includes(request.approval_status)) {
      throw new Error("This part request was already reviewed.");
    }
    const values = {
      partNumber: input.partNumber || request.part_number,
      manufacturer: input.manufacturer || request.manufacturer,
      description: input.description || request.description,
      category: input.category || request.category,
      quantity: input.quantity,
      repairOrder: input.repairOrder || request.repair_order,
    };
    const catalogPartId = input.decision === PART_APPROVAL_STATUS.APPROVED
      ? await upsertCatalogPart(client, request.company_id, values)
      : request.catalog_part_id;
    await client.query(
      `
        update workorder_part_requests set
          catalog_part_id = $2,
          part_number = $3,
          normalized_part_number = $4,
          manufacturer = $5,
          description = $6,
          category = $7,
          quantity = $8,
          repair_order = $9,
          approval_status = $10,
          fitment_status = $11,
          fitment_notes = $12,
          approved_by_user_id = case when $10 = 'approved' then $13::uuid else null end,
          approved_at = case when $10 = 'approved' then now() else null end,
          decision_reason = $14,
          updated_at = now()
        where id = $1
      `,
      [
        requestId,
        catalogPartId,
        values.partNumber,
        normalizePartNumber(values.partNumber),
        values.manufacturer,
        values.description,
        values.category,
        values.quantity,
        values.repairOrder,
        input.decision,
        input.fitmentStatus,
        input.fitmentNotes || "",
        actorUserId || null,
        input.reason || "",
      ]
    );
    if (input.decision === PART_APPROVAL_STATUS.APPROVED) {
      const allocations = input.allocations.length ? input.allocations : [{ sourceType: "unknown", status: "proposed", quantity: values.quantity }];
      for (const allocation of allocations) {
        await createAllocation(client, {
          requestId,
          workorder: { company_id: request.company_id, location_id: request.location_id },
          actorUserId,
          allocation,
          normalizedPartNumber: normalizePartNumber(values.partNumber),
        });
      }
      await projectApprovedParts(client, workorderId);
    }
    const eventType = input.decision;
    const label = values.partNumber || values.description || request.raw_query;
    await addPartEvent(client, {
      workorderId,
      partRequestId: requestId,
      eventType,
      actorUserId,
      note: input.reason || `Part request ${eventType}: ${label}.`,
      metadata: { allocations: input.allocations.length, fitmentStatus: input.fitmentStatus },
    });
    await addSystemMessage(client, workorderId, input.reason
      ? `Part request ${eventType}: ${label}. ${input.reason}`
      : `Part request ${eventType}: ${label}.`);
    await restoreWorkorderWhenResolved(client, {
      id: workorderId,
      status: request.workorder_status,
      current_mechanic_id: request.current_mechanic_id,
    }, actorUserId);
    await client.query("commit");
    return (await listWorkorderPartRequests(workorderId)).find((part) => part.id === requestId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePartAllocation(workorderId, requestId, allocationId, input, actorUserId) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `select pa.*, pr.workorder_id
       from part_allocations pa
       join workorder_part_requests pr on pr.id = pa.part_request_id
       where pa.id = $1 and pa.part_request_id = $2 and pr.workorder_id = $3
       for update`,
      [allocationId, requestId, workorderId]
    );
    const allocation = result.rows[0];
    if (!allocation) throw new Error("Part allocation not found.");
    if (allocation.inventory_item_id && allocation.source_type === "inventory" && allocation.status !== input.status) {
      await client.query("select id from inventory_items where id = $1 for update", [allocation.inventory_item_id]);
      if (allocation.status === "reserved" && input.status === "issued") {
        await client.query(
          `update inventory_items set quantity_reserved = quantity_reserved - $2, quantity_on_hand = quantity_on_hand - $2, updated_at = now() where id = $1`,
          [allocation.inventory_item_id, allocation.quantity]
        );
      } else if (allocation.status === "reserved" && input.status === "cancelled") {
        await client.query(
          `update inventory_items set quantity_reserved = quantity_reserved - $2, updated_at = now() where id = $1`,
          [allocation.inventory_item_id, allocation.quantity]
        );
      } else if (allocation.status === "issued" && input.status === "returned") {
        await client.query(
          `update inventory_items set quantity_on_hand = quantity_on_hand + $2, updated_at = now() where id = $1`,
          [allocation.inventory_item_id, allocation.quantity]
        );
      }
    }
    await client.query("update part_allocations set status = $2, updated_at = now() where id = $1", [allocationId, input.status]);
    await addPartEvent(client, {
      workorderId,
      partRequestId: requestId,
      eventType: "allocation_updated",
      actorUserId,
      note: input.note || `${allocation.source_type} allocation changed from ${allocation.status} to ${input.status}.`,
      metadata: { allocationId, from: allocation.status, to: input.status },
    });
    await client.query("commit");
    return (await listWorkorderPartRequests(workorderId)).find((part) => part.id === requestId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePartUsage(workorderId, requestId, input) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `select
         pr.*,
         exists (
           select 1 from workorder_mechanic_assignments assignment
           where assignment.workorder_id = wo.id
             and assignment.mechanic_user_id = $3
             and assignment.active = true
         ) as mechanic_assigned
       from workorder_part_requests pr
       join operational_workorders wo on wo.id = pr.workorder_id
       where pr.id = $1 and pr.workorder_id = $2 for update`,
      [requestId, workorderId, input.mechanicUserId]
    );
    const request = result.rows[0];
    if (!request) throw new Error("Part request not found.");
    if (!request.mechanic_assigned) throw new Error("Only an assigned mechanic can update part usage.");
    if (request.approval_status !== PART_APPROVAL_STATUS.APPROVED) throw new Error("Only approved parts can be issued or installed.");
    await client.query("update workorder_part_requests set usage_status = $2, updated_at = now() where id = $1", [requestId, input.usageStatus]);
    await addPartEvent(client, {
      workorderId,
      partRequestId: requestId,
      eventType: "usage_updated",
      actorUserId: input.mechanicUserId,
      note: input.note || `Part usage changed from ${request.usage_status} to ${input.usageStatus}.`,
      metadata: { from: request.usage_status, to: input.usageStatus },
    });
    await client.query("commit");
    return (await listWorkorderPartRequests(workorderId)).find((part) => part.id === requestId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
