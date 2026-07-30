import { getPool, query } from "../pool.js";

export async function setWorkorderAttention({ workorderId, reason, active, actorUserId, details = {} }) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const existing = await client.query(
      `select id, active from workorder_attention_state
       where workorder_id = $1 and reason = $2
       for update`,
      [workorderId, reason],
    );
    const previous = existing.rows[0];
    const action = active
      ? previous?.active === false ? "reopened" : previous ? "updated" : "opened"
      : "resolved";
    const state = await client.query(
      `insert into workorder_attention_state (
         workorder_id, reason, active, details, opened_by_user_id,
         resolved_by_user_id, resolved_at, updated_at
       ) values ($1, $2, $3, $4::jsonb, $5::uuid, case when $3 then null::uuid else $5::uuid end, case when $3 then null else now() end, now())
       on conflict (workorder_id, reason) do update
       set active = excluded.active,
           details = excluded.details,
           opened_by_user_id = case when excluded.active then coalesce(workorder_attention_state.opened_by_user_id, excluded.opened_by_user_id) else workorder_attention_state.opened_by_user_id end,
           opened_at = case when excluded.active and workorder_attention_state.active = false then now() else workorder_attention_state.opened_at end,
           resolved_by_user_id = excluded.resolved_by_user_id,
           resolved_at = excluded.resolved_at,
           updated_at = now()
       returning *`,
      [workorderId, reason, active, JSON.stringify(details), actorUserId || null],
    );
    if (!previous || previous.active !== active || action === "updated") {
      await client.query(
        `insert into workorder_attention_events (workorder_id, reason, action, actor_user_id, details)
         values ($1, $2, $3, $4::uuid, $5::jsonb)`,
        [workorderId, reason, action, actorUserId || null, JSON.stringify(details)],
      );
    }
    await client.query("commit");
    return state.rows[0];
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function markWorkorderRead({ workorderId, userId, lastSeenActivityAt }) {
  const result = await query(
    `insert into workorder_read_state (workorder_id, user_id, last_read_at, last_seen_activity_at, updated_at)
     values ($1, $2, now(), $3, now())
     on conflict (workorder_id, user_id) do update
     set last_read_at = now(),
         last_seen_activity_at = excluded.last_seen_activity_at,
         updated_at = now()
     returning *`,
    [workorderId, userId, lastSeenActivityAt || null],
  );
  return result.rows[0];
}

export async function listActiveWorkorderAttention(workorderId) {
  const result = await query(
    `select reason, details, opened_at, updated_at
     from workorder_attention_state
     where workorder_id = $1 and active = true
     order by opened_at asc`,
    [workorderId],
  );
  return result.rows.map((row) => ({
    reason: row.reason,
    details: row.details || {},
    openedAt: row.opened_at,
    updatedAt: row.updated_at,
  }));
}

export async function getWorkorderPreferences(userId) {
  const result = await query(
    `select user_id, default_location_id, default_view, page_size, saved_filters, updated_at
     from user_workorder_preferences where user_id = $1`,
    [userId],
  );
  return result.rows[0] || null;
}

export async function saveWorkorderPreferences(userId, input) {
  const result = await query(
    `insert into user_workorder_preferences (user_id, default_location_id, default_view, page_size, saved_filters, updated_at)
     values ($1, $2, $3, $4, $5::jsonb, now())
     on conflict (user_id) do update
     set default_location_id = excluded.default_location_id,
         default_view = excluded.default_view,
         page_size = excluded.page_size,
         saved_filters = excluded.saved_filters,
         updated_at = now()
     returning *`,
    [userId, input.defaultLocationId || null, input.defaultView || "all", input.pageSize || 50, JSON.stringify(input.savedFilters || {})],
  );
  return result.rows[0];
}
