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

function publicMessage(row) {
  return {
    id: row.id,
    workorderId: row.workorder_id,
    senderUserId: row.sender_user_id,
    senderRole: row.sender_role,
    senderName: row.sender_name || row.sender_role,
    messageType: row.message_type,
    body: row.body,
    attachment: publicAttachment(row),
    createdAt: row.created_at,
  };
}

export async function listChatMessages(workorderId) {
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
        attachment.created_at as attachment_created_at
      from chat_messages cm
      left join user_profiles u on u.id = cm.sender_user_id
      left join chat_message_attachments attachment on attachment.message_id = cm.id
      where cm.workorder_id = $1
      order by cm.created_at asc
    `,
    [workorderId]
  );
  return result.rows.map(publicMessage);
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
        returning id, workorder_id, sender_user_id, sender_role, message_type, body, created_at
      `,
      [workorderId, senderUserId || null, senderRole, messageType, body, dedupeKey]
    );

    let insertedAttachment = null;
    if (attachment) {
      const attachmentResult = await client.query(
        `
          insert into chat_message_attachments (
            message_id, workorder_id, storage_key, original_file_name, mime_type, byte_size, sha256
          ) values ($1, $2, $3, $4, $5, $6, $7)
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
    });
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
      select id, message_id, workorder_id, storage_key, original_file_name, mime_type, byte_size, sha256, created_at
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
