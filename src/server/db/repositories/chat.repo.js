import { getPool, query } from "../pool.js";
import { WORKORDER_STATUS } from "../../modules/workorders/workorder.constants.js";

function publicAttachment(row) {
  if (!row?.attachment_id) return null;
  return {
    id: row.attachment_id,
    fileName: row.attachment_file_name,
    mimeType: row.attachment_mime_type,
    byteSize: row.attachment_byte_size,
    url: `/api/mechanic/chat-media/${encodeURIComponent(row.attachment_id)}`,
    createdAt: row.attachment_created_at,
  };
}

export function chatReceiptFromRow(row, viewerUserId) {
  const isSystem = row.message_type === "system" || row.sender_role === "system";
  if (isSystem || !viewerUserId || row.sender_user_id !== viewerUserId) return null;
  const deliveredCount = Number(row.receipt_delivered_count || 0);
  const readCount = Number(row.receipt_read_count || 0);
  return {
    status: readCount > 0 ? "read" : deliveredCount > 0 ? "delivered" : "sent",
    deliveredCount,
    readCount,
    deliveredAt: row.receipt_delivered_at || null,
    readAt: row.receipt_read_at || null,
  };
}

export function chatMessageDedupeKey(senderUserId, clientMessageId) {
  return senderUserId && clientMessageId
    ? `client-message:${senderUserId}:${clientMessageId}`
    : null;
}

function publicMessage(row, viewerUserId = null) {
  return {
    id: row.id,
    workorderId: row.workorder_id,
    senderUserId: row.sender_user_id,
    senderRole: row.sender_role,
    senderName: row.sender_name || row.sender_role,
    messageType: row.message_type,
    body: row.body,
    attachment: publicAttachment(row),
    receipt: chatReceiptFromRow(row, viewerUserId),
    createdAt: row.created_at,
  };
}

export async function listChatMessages(workorderId, { viewerUserId = null } = {}) {
  const result = await query(
    `
      select
        cm.id,
        cm.workorder_id,
        cm.sender_user_id,
        cm.sender_role,
        cm.message_type,
        cm.body,
        cm.created_at,
        u.display_name as sender_name,
        attachment.id as attachment_id,
        attachment.original_file_name as attachment_file_name,
        attachment.mime_type as attachment_mime_type,
        attachment.byte_size as attachment_byte_size,
        attachment.created_at as attachment_created_at,
        receipt.delivered_count as receipt_delivered_count,
        receipt.read_count as receipt_read_count,
        receipt.delivered_at as receipt_delivered_at,
        receipt.read_at as receipt_read_at
      from chat_messages cm
      left join user_profiles u on u.id = cm.sender_user_id
      left join chat_message_attachments attachment on attachment.message_id = cm.id
      left join (
        select
          cmr.message_id,
          count(*) as delivered_count,
          count(*) filter (where cmr.read_at is not null) as read_count,
          min(cmr.delivered_at) as delivered_at,
          min(cmr.read_at) as read_at
        from chat_message_receipts cmr
        join chat_messages receipt_message on receipt_message.id = cmr.message_id
        where receipt_message.workorder_id = $1
          and receipt_message.sender_user_id = $2
        group by cmr.message_id
      ) receipt on receipt.message_id = cm.id
      where cm.workorder_id = $1
      order by cm.created_at asc, cm.id asc
    `,
    [workorderId, viewerUserId]
  );
  return result.rows.map((row) => publicMessage(row, viewerUserId));
}

export async function acknowledgeChatMessageReceiptsThrough({
  workorderId,
  actorUserId,
  throughMessageId,
  status,
}) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const target = await client.query(
      `
        select id, created_at
        from chat_messages
        where id = $1
          and workorder_id = $2
          and sender_user_id is not null
          and sender_user_id <> $3
          and sender_role <> 'system'
          and message_type <> 'system'
        limit 1
        for share
      `,
      [throughMessageId, workorderId, actorUserId],
    );
    if (!target.rows[0]) {
      await client.query("rollback");
      return null;
    }

    const acknowledged = await client.query(
      `
        insert into chat_message_receipts (message_id, user_id, delivered_at, read_at)
        select
          cm.id,
          $2,
          now(),
          case when $4 = 'read' then now() else null end
        from chat_messages cm
        join chat_messages boundary
          on boundary.id = $3
         and boundary.workorder_id = $1
        where cm.workorder_id = $1
          and (cm.created_at, cm.id) <= (boundary.created_at, boundary.id)
          and cm.sender_user_id is not null
          and cm.sender_user_id is distinct from $2
          and cm.sender_role <> 'system'
          and cm.message_type <> 'system'
        on conflict (message_id, user_id) do update
        set delivered_at = least(chat_message_receipts.delivered_at, excluded.delivered_at),
            read_at = case
              when $4 = 'read' then coalesce(chat_message_receipts.read_at, excluded.read_at)
              else chat_message_receipts.read_at
            end
        returning message_id, delivered_at, read_at
      `,
      [workorderId, actorUserId, target.rows[0].id, status],
    );

    await client.query("commit");
    return {
      throughMessageId,
      status,
      acknowledgedCount: acknowledged.rowCount,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function addChatMessage({ workorderId, senderUserId, senderRole, messageType = "normal", body = "", attachment = null, dedupeKey = null }) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const message = await client.query(
      `
        insert into chat_messages (workorder_id, sender_user_id, sender_role, message_type, body, dedupe_key)
        values ($1, $2, $3, $4, $5, $6)
        on conflict (workorder_id, dedupe_key) where dedupe_key is not null do nothing
        returning id, workorder_id, sender_user_id, sender_role, message_type, body, created_at
      `,
      [workorderId, senderUserId || null, senderRole, messageType, body, dedupeKey]
    );
    if (!message.rows[0]) {
      const existing = await client.query(
        `
          select
            cm.id,
            cm.workorder_id,
            cm.sender_user_id,
            cm.sender_role,
            cm.message_type,
            cm.body,
            cm.created_at,
            attachment.id as attachment_id,
            attachment.original_file_name as attachment_file_name,
            attachment.mime_type as attachment_mime_type,
            attachment.byte_size as attachment_byte_size,
            attachment.created_at as attachment_created_at
          from chat_messages cm
          left join chat_message_attachments attachment on attachment.message_id = cm.id
          where cm.workorder_id = $1
            and cm.dedupe_key = $2
            and cm.sender_user_id = $3
          limit 1
        `,
        [workorderId, dedupeKey, senderUserId],
      );
      if (!existing.rows[0]) throw new Error("Idempotent chat message could not be loaded.");
      await client.query("commit");
      return {
        ...publicMessage(existing.rows[0], senderUserId),
        deduplicated: true,
      };
    }

    let insertedAttachment = null;
    if (attachment) {
      const attachmentResult = await client.query(
        `
          insert into chat_message_attachments (
            message_id, workorder_id, storage_key, original_file_name, mime_type, byte_size, sha256, content
          ) values ($1, $2, $3, $4, $5, $6, $7, $8)
          returning id, original_file_name, mime_type, byte_size, created_at
        `,
        [
          message.rows[0].id,
          workorderId,
          attachment.storageKey,
          attachment.fileName,
          attachment.mimeType,
          attachment.byteSize,
          attachment.sha256,
          attachment.content,
        ]
      );
      insertedAttachment = attachmentResult.rows[0];
    }

    if (senderRole === "mechanic" && (messageType === "part_request" || messageType === "help_request")) {
      const nextStatus = messageType === "part_request" ? WORKORDER_STATUS.PARTS_REQUESTED : WORKORDER_STATUS.WAITING_OFFICE;
      const current = await client.query("select status from operational_workorders where id = $1 for update", [workorderId]);
      const workorder = current.rows[0];
      if (workorder && workorder.status !== WORKORDER_STATUS.MECHANIC_DONE && workorder.status !== WORKORDER_STATUS.CLOSED) {
        await client.query(
          `
            update operational_workorders
            set status = $2,
                updated_at = now()
            where id = $1
          `,
          [workorderId, nextStatus]
        );
        if (workorder.status !== nextStatus) {
          await client.query(
            `
              insert into workorder_status_events (workorder_id, from_status, to_status, changed_by_user_id, note)
              values ($1, $2, $3, $4, $5)
            `,
            [workorderId, workorder.status, nextStatus, senderUserId || null, body]
          );
        }
      }
    } else {
      await client.query("update operational_workorders set updated_at = now() where id = $1", [workorderId]);
    }

    await client.query("commit");
    const row = message.rows[0];
    return publicMessage({
      ...row,
      attachment_id: insertedAttachment?.id,
      attachment_file_name: insertedAttachment?.original_file_name,
      attachment_mime_type: insertedAttachment?.mime_type,
      attachment_byte_size: insertedAttachment?.byte_size,
      attachment_created_at: insertedAttachment?.created_at,
    }, row.sender_user_id);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateChatMessageType({ workorderId, messageId, messageType }) {
  const result = await query(
    `update chat_messages set message_type = $3 where id = $1 and workorder_id = $2 returning id`,
    [messageId, workorderId, messageType]
  );
  return Boolean(result.rowCount);
}

export async function addSystemChatMessageOnce({ workorderId, body, dedupeKey }) {
  const result = await query(
    `
      insert into chat_messages (workorder_id, sender_role, message_type, body, dedupe_key)
      values ($1, 'system', 'system', $2, $3)
      on conflict (workorder_id, dedupe_key) where dedupe_key is not null do nothing
      returning id, workorder_id, sender_user_id, sender_role, message_type, body, created_at
    `,
    [workorderId, body, dedupeKey]
  );
  return result.rows[0] ? publicMessage(result.rows[0]) : null;
}

export async function getChatAttachmentById(attachmentId) {
  const result = await query(
    `
      select id, message_id, workorder_id, storage_key, original_file_name, mime_type, byte_size, sha256, content, created_at
      from chat_message_attachments
      where id = $1
      limit 1
    `,
    [attachmentId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    messageId: row.message_id,
    workorderId: row.workorder_id,
    storageKey: row.storage_key,
    fileName: row.original_file_name,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    content: row.content,
    createdAt: row.created_at,
  };
}

export async function getMechanicChatContext(workorderId) {
  const result = await query(
    `
      select
        wo.id,
        wo.company_id,
        (
          select assignment.mechanic_user_id
          from workorder_mechanic_assignments assignment
          where assignment.workorder_id = wo.id
            and assignment.active
            and assignment.assignment_role = 'primary'
          limit 1
        ) as primary_mechanic_id,
        wo.status,
        wo.form_data,
        a.id as asset_id,
        a.unit_no,
        a.name as asset_name,
        a.vin,
        a.make,
        a.model,
        a.year,
        a.raw_provider_data,
        l.id as location_id,
        l.name as location_name,
        l.address as location_address
      from operational_workorders wo
      left join assets a on a.id = wo.asset_id
      left join locations l on l.id = wo.location_id
      where wo.id = $1
      limit 1
    `,
    [workorderId]
  );
  return result.rows[0] || null;
}
