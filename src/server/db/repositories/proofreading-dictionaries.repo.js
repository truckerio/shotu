import { getPool, query } from "../pool.js";

function boundedLimit(value, fallback = 500) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, fallback);
}

export async function listActiveProofreadingDictionaryTerms({ companyId, ownerUserId, limit = 500 }) {
  const result = await query(
    `select distinct on (term.normalized_term)
       term.id,
       term.company_id,
       term.owner_user_id,
       term.display_term,
       term.normalized_term,
       term.created_at,
       term.updated_at
     from proofreading_dictionary_terms term
     where term.company_id = $1
       and term.active
       and (term.owner_user_id is null or term.owner_user_id = $2)
     order by
       term.normalized_term,
       (term.owner_user_id = $2) desc,
       term.updated_at desc
     limit $3`,
    [companyId, ownerUserId, boundedLimit(limit)],
  );
  return result.rows;
}

export async function saveProofreadingDictionaryTerm({
  actorUserId,
  companyId,
  displayTerm,
  normalizedTerm,
  ownerUserId = null,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const existing = await client.query(
      `select *
       from proofreading_dictionary_terms
       where company_id = $1
         and owner_user_id is not distinct from $2::uuid
         and normalized_term = $3
       order by active desc, updated_at desc
       limit 1
       for update`,
      [companyId, ownerUserId, normalizedTerm],
    );

    let term = existing.rows[0];
    if (term) {
      const updated = await client.query(
        `update proofreading_dictionary_terms
         set display_term = $2,
             active = true,
             removed_by_user_id = null,
             removed_at = null,
             updated_at = now()
         where id = $1
         returning *`,
        [term.id, displayTerm],
      );
      term = updated.rows[0];
    } else {
      const inserted = await client.query(
        `insert into proofreading_dictionary_terms (
           company_id,
           owner_user_id,
           display_term,
           normalized_term,
           created_by_user_id
         )
         values ($1, $2, $3, $4, $5)
         on conflict do nothing
         returning *`,
        [companyId, ownerUserId, displayTerm, normalizedTerm, actorUserId],
      );
      term = inserted.rows[0];
      if (!term) {
        const concurrent = await client.query(
          `select *
           from proofreading_dictionary_terms
           where company_id = $1
             and owner_user_id is not distinct from $2::uuid
             and normalized_term = $3
             and active
           limit 1
           for update`,
          [companyId, ownerUserId, normalizedTerm],
        );
        term = concurrent.rows[0];
      }
    }

    if (!term) throw new Error("Proofreading dictionary term could not be saved.");
    await client.query(
      `insert into proofreading_dictionary_events (
         dictionary_term_id,
         company_id,
         owner_user_id,
         actor_user_id,
         action,
         display_term,
         normalized_term
       )
       values ($1, $2, $3, $4, 'add', $5, $6)`,
      [term.id, companyId, ownerUserId, actorUserId, term.display_term, term.normalized_term],
    );
    await client.query("commit");
    return term;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function removeProofreadingDictionaryTerm({
  actorUserId,
  companyId,
  normalizedTerm,
  ownerUserId = null,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const removed = await client.query(
      `update proofreading_dictionary_terms
       set active = false,
           removed_by_user_id = $4,
           removed_at = now(),
           updated_at = now()
       where company_id = $1
         and owner_user_id is not distinct from $2::uuid
         and normalized_term = $3
         and active
       returning *`,
      [companyId, ownerUserId, normalizedTerm, actorUserId],
    );
    const term = removed.rows[0] || null;
    if (term) {
      await client.query(
        `insert into proofreading_dictionary_events (
           dictionary_term_id,
           company_id,
           owner_user_id,
           actor_user_id,
           action,
           display_term,
           normalized_term
         )
         values ($1, $2, $3, $4, 'remove', $5, $6)`,
        [term.id, companyId, ownerUserId, actorUserId, term.display_term, term.normalized_term],
      );
    }
    await client.query("commit");
    return term;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
