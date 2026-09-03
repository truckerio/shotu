import { query } from "../pool.js";
import { requireCompanyId } from "../company.js";
import { normalizePartNumber } from "../../modules/parts/part.constants.js";

const MAX_SUGGESTIONS = 10;
const MAX_CANDIDATE_ROWS = 500;
const MAX_EXAMPLES = 3;
const MAX_HISTORY_PAGE_SIZE = 50;
const MAX_HISTORY_TEXT_LENGTH = 4_000;
const MAX_HISTORY_LINE_TEXT_LENGTH = 1_000;
const MAX_HISTORY_PART_FIELD_LENGTH = 300;
const MAX_HISTORY_SERVICE_LINES = 25;
const MAX_HISTORY_PARTS = 50;

function cleanRepairText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function canonicalRepairText(value) {
  return cleanRepairText(value).toLocaleLowerCase("en-US");
}

function publicExample(row) {
  return {
    workorderId: row.source_provider === "local" ? row.external_id : null,
    serviceOrderId: row.service_order_id,
    reference: row.reference || "",
    assetId: row.asset_id || null,
    usedAt: row.used_at,
  };
}

function sourceProviders(row) {
  return Array.isArray(row.source_providers) ? row.source_providers : [row.source_provider];
}

function rowExamples(row) {
  return Array.isArray(row.examples) ? row.examples : [publicExample(row)];
}

export function rankPartRepairHistoryRows(rows, { assetId, limit = 5 } = {}) {
  const groups = new Map();
  for (const row of rows) {
    const text = cleanRepairText(row.repair_text);
    if (!text) continue;
    const key = canonicalRepairText(text);
    const current = groups.get(key) || {
      text,
      confidence: "context",
      sourceProviders: new Set(),
      orderIds: new Set(),
      latestUsedAt: null,
      sameAssetCount: 0,
      proximityScore: 0,
      examples: [],
    };
    for (const provider of sourceProviders(row)) current.sourceProviders.add(provider);
    if (row.service_order_id) current.orderIds.add(row.service_order_id);
    current.usageCount = (current.usageCount || 0) + (Number(row.usage_count) || 0);
    if (row.confidence === "confirmed") current.confidence = "confirmed";
    const usedAt = row.used_at ? new Date(row.used_at) : null;
    if (usedAt && !Number.isNaN(usedAt.valueOf())) {
      if (!current.latestUsedAt || usedAt > current.latestUsedAt) current.latestUsedAt = usedAt;
    }
    current.sameAssetCount += Number(row.same_asset_count) || (assetId && row.asset_id === assetId ? 1 : 0);
    current.proximityScore = Math.max(current.proximityScore, Number(row.proximity_score) || Number(row.evidence?.proximityScore) || 0);
    current.examples.push(...rowExamples(row));
    groups.set(key, current);
  }

  return [...groups.values()]
    .sort((left, right) => {
      if (left.confidence !== right.confidence) return left.confidence === "confirmed" ? -1 : 1;
      const leftUsage = left.usageCount || left.orderIds.size;
      const rightUsage = right.usageCount || right.orderIds.size;
      if (leftUsage !== rightUsage) return rightUsage - leftUsage;
      if (left.sameAssetCount !== right.sameAssetCount) return right.sameAssetCount - left.sameAssetCount;
      if (left.proximityScore !== right.proximityScore) return right.proximityScore - left.proximityScore;
      const leftTime = left.latestUsedAt?.valueOf() || 0;
      const rightTime = right.latestUsedAt?.valueOf() || 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return left.text.localeCompare(right.text);
    })
    .slice(0, Math.max(1, Math.min(MAX_SUGGESTIONS, Number(limit) || 5)))
    .map((candidate) => ({
      text: candidate.text,
      usageCount: candidate.usageCount || candidate.orderIds.size,
      latestUsedAt: candidate.latestUsedAt?.toISOString() || null,
      confidence: candidate.confidence,
      source: candidate.sourceProviders.size === 1 ? [...candidate.sourceProviders][0] : "mixed",
      sameAsset: candidate.sameAssetCount > 0,
      examples: candidate.examples
        .sort((left, right) => String(right.usedAt || "").localeCompare(String(left.usedAt || "")))
        .filter((example, index, all) => all.findIndex((item) => item.serviceOrderId === example.serviceOrderId) === index)
        .slice(0, MAX_EXAMPLES),
    }));
}

export async function suggestCompanyPartRepairs(companyId, {
  catalogPartId = null,
  partNumber = "",
  assetId = null,
  limit = 5,
} = {}) {
  const tenantId = requireCompanyId(companyId);
  const normalized = normalizePartNumber(partNumber);
  if (!catalogPartId && !normalized) return [];

  const result = await query(
    `with target_catalog as (
       select id, normalized_part_number
       from parts_catalog
       where company_id = $1 and id = $2::uuid
         and ($3::text = '' or normalized_part_number = $3)
     ), matching_history as (
       select
         history.*,
         history_order.external_id,
         history_order.reference,
         lower(regexp_replace(btrim(history.repair_text), '\\s+', ' ', 'g')) as canonical_text
       from part_repair_history history
       join service_history_orders history_order
         on history_order.company_id = history.company_id
        and history_order.id = history.service_order_id
       where history.company_id = $1
         and (
           ($2::uuid is not null and exists (
             select 1 from target_catalog target
             where history.catalog_part_id = target.id
                or (history.catalog_part_id is null
                    and history.normalized_part_number = target.normalized_part_number)
           ))
           or ($2::uuid is null and $3::text <> '' and history.normalized_part_number = $3)
         )
         and btrim(history.repair_text) <> ''
     ), aggregated as (
       select
         canonical_text,
         (array_agg(repair_text order by (confidence = 'confirmed') desc, used_at desc nulls last))[1] as repair_text,
         case when bool_or(confidence = 'confirmed') then 'confirmed' else 'context' end as confidence,
         array_agg(distinct source_provider) as source_providers,
         count(distinct service_order_id)::int as usage_count,
         max(used_at) as latest_used_at,
         count(distinct service_order_id) filter (where asset_id = $4::uuid)::int as same_asset_count,
         max(coalesce((evidence ->> 'proximityScore')::numeric, 0)) as proximity_score,
         to_jsonb((array_agg(
           jsonb_build_object(
             'workorderId', case when source_provider = 'local' then external_id else null end,
             'serviceOrderId', service_order_id,
             'reference', reference,
             'assetId', asset_id,
             'usedAt', used_at
           ) order by used_at desc nulls last
         ))[1:3]) as examples
       from matching_history
       group by canonical_text
     )
     select
       repair_text, confidence, source_providers, usage_count,
       latest_used_at as used_at, same_asset_count, proximity_score, examples
     from aggregated
     order by
       (confidence = 'confirmed') desc,
       usage_count desc,
       same_asset_count desc,
       proximity_score desc,
       latest_used_at desc nulls last,
       canonical_text
     limit $5`,
    [tenantId, catalogPartId, normalized, assetId, MAX_CANDIDATE_ROWS],
  );

  return rankPartRepairHistoryRows(result.rows, { assetId, limit });
}

export async function readServiceHistorySyncState(companyId, provider) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `select provider_watermark, last_reconciled_at,
            last_attempted_at, last_succeeded_at, last_error_at,
            last_error_code, last_error_message
     from service_history_sync_state
     where company_id = $1 and source_provider = $2`,
    [tenantId, provider],
  );
  return {
    providerWatermark: result.rows[0]?.provider_watermark || null,
    lastReconciledAt: result.rows[0]?.last_reconciled_at || null,
    lastAttemptedAt: result.rows[0]?.last_attempted_at || null,
    lastSucceededAt: result.rows[0]?.last_succeeded_at || null,
    lastErrorAt: result.rows[0]?.last_error_at || null,
    lastErrorCode: result.rows[0]?.last_error_code || "",
    lastErrorMessage: result.rows[0]?.last_error_message || "",
  };
}

export async function markServiceHistorySyncAttempted(companyId, provider, attemptedAt = new Date()) {
  const tenantId = requireCompanyId(companyId);
  await query(
    `insert into service_history_sync_state (
       company_id, source_provider, last_attempted_at, updated_at
     ) values ($1, $2, $3, now())
     on conflict (company_id, source_provider) do update
     set last_attempted_at = greatest(
           service_history_sync_state.last_attempted_at,
           excluded.last_attempted_at
         ),
         updated_at = now()`,
    [tenantId, provider, attemptedAt],
  );
}

export async function markServiceHistorySyncSucceeded(companyId, provider, {
  providerWatermark,
  reconciled = false,
}) {
  const tenantId = requireCompanyId(companyId);
  await query(
    `insert into service_history_sync_state (
       company_id, source_provider, provider_watermark, last_reconciled_at,
       last_attempted_at, last_succeeded_at, last_error_at,
       last_error_code, last_error_message, updated_at
     ) values (
       $1, $2, $3::timestamptz, case when $4::boolean then $3::timestamptz else null end,
       $3::timestamptz, $3::timestamptz, null, '', '', now()
     )
     on conflict (company_id, source_provider) do update
     set provider_watermark = greatest(
           service_history_sync_state.provider_watermark,
           excluded.provider_watermark
         ),
         last_reconciled_at = case
           when $4::boolean then greatest(
             service_history_sync_state.last_reconciled_at,
             excluded.last_reconciled_at
           )
           else service_history_sync_state.last_reconciled_at
         end,
         last_attempted_at = greatest(
           service_history_sync_state.last_attempted_at,
           excluded.last_attempted_at
         ),
         last_succeeded_at = greatest(
           service_history_sync_state.last_succeeded_at,
           excluded.last_succeeded_at
         ),
         last_error_at = case
           when excluded.last_succeeded_at >= service_history_sync_state.last_attempted_at then null
           else service_history_sync_state.last_error_at
         end,
         last_error_code = case
           when excluded.last_succeeded_at >= service_history_sync_state.last_attempted_at then ''
           else service_history_sync_state.last_error_code
         end,
         last_error_message = case
           when excluded.last_succeeded_at >= service_history_sync_state.last_attempted_at then ''
           else service_history_sync_state.last_error_message
         end,
         updated_at = now()`,
    [tenantId, provider, providerWatermark, reconciled],
  );
}

export async function markServiceHistorySyncFailed(companyId, provider, {
  attemptedAt = new Date(),
  code = "SERVICE_HISTORY_SYNC_FAILED",
  message = "Service history could not be synchronized.",
} = {}) {
  const tenantId = requireCompanyId(companyId);
  const safeCode = String(code || "SERVICE_HISTORY_SYNC_FAILED")
    .replace(/[^A-Z0-9_]/gi, "_").toUpperCase().slice(0, 80);
  const safeMessage = String(message || "Service history could not be synchronized.")
    .replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
  await query(
    `insert into service_history_sync_state (
       company_id, source_provider, last_attempted_at, last_error_at,
       last_error_code, last_error_message, updated_at
     ) values ($1, $2, $3, $3, $4, $5, now())
     on conflict (company_id, source_provider) do update
     set last_attempted_at = greatest(
           service_history_sync_state.last_attempted_at,
           excluded.last_attempted_at
         ),
         last_error_at = case
           when excluded.last_attempted_at >= service_history_sync_state.last_attempted_at
             then excluded.last_error_at
           else service_history_sync_state.last_error_at
         end,
         last_error_code = case
           when excluded.last_attempted_at >= service_history_sync_state.last_attempted_at
             then excluded.last_error_code
           else service_history_sync_state.last_error_code
         end,
         last_error_message = case
           when excluded.last_attempted_at >= service_history_sync_state.last_attempted_at
             then excluded.last_error_message
           else service_history_sync_state.last_error_message
         end,
         updated_at = now()`,
    [tenantId, provider, attemptedAt, safeCode, safeMessage],
  );
}

export function encodeUnitHistoryCursor({ serviceAt, id }) {
  return Buffer.from(JSON.stringify({ serviceAt, id }), "utf8").toString("base64url");
}

export function decodeUnitHistoryCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    const date = new Date(value.serviceAt);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value.id || ""))
      || Number.isNaN(date.valueOf())) throw new Error("invalid cursor");
    return { serviceAt: date.toISOString(), id: String(value.id) };
  } catch {
    const error = new Error("Invalid service history cursor.");
    error.statusCode = 400;
    error.code = "INVALID_SERVICE_HISTORY_CURSOR";
    throw error;
  }
}

function publicHistoryItem(row) {
  return {
    id: row.id,
    source: row.source_provider,
    reference: row.reference || "",
    status: row.status || "",
    serviceDate: row.service_at,
    dateKind: row.date_kind,
    completedAt: row.completed_at || null,
    scheduledAt: row.scheduled_at || null,
    recordedAt: row.recorded_at || null,
    concern: row.concern || "",
    diagnosis: row.diagnosis || "",
    workPerformed: row.work_performed || "",
    serviceLines: Array.isArray(row.service_lines) ? row.service_lines : [],
    parts: Array.isArray(row.parts) ? row.parts : [],
    truncated: {
      reference: Boolean(row.reference_truncated),
      status: Boolean(row.status_truncated),
      concern: Boolean(row.concern_truncated),
      diagnosis: Boolean(row.diagnosis_truncated),
      workPerformed: Boolean(row.work_performed_truncated),
      serviceLines: Boolean(row.service_lines_truncated),
      parts: Boolean(row.parts_truncated),
    },
  };
}

export async function listUnitServiceHistory(companyId, assetId, currentWorkorderId, {
  limit = 10,
  cursor = null,
} = {}) {
  const tenantId = requireCompanyId(companyId);
  const pageSize = Math.max(1, Math.min(MAX_HISTORY_PAGE_SIZE, Number(limit) || 10));
  const after = decodeUnitHistoryCursor(cursor);
  const result = await query(
    `with eligible as (
       select
         history.id,
         history.company_id,
         history.source_provider,
         history.external_id,
         left(history.reference, ${MAX_HISTORY_PART_FIELD_LENGTH}) as reference,
         length(history.reference) > ${MAX_HISTORY_PART_FIELD_LENGTH} as reference_truncated,
         left(history.status, 80) as status,
         length(history.status) > 80 as status_truncated,
         history.completed_at,
         history.scheduled_at,
         history.recorded_at,
         case
           when history.completed_at is not null then history.completion_date_kind
           when history.recorded_at is not null then 'recorded'
           when history.scheduled_at is not null then 'scheduled'
           else 'unknown'
         end as date_kind,
         coalesce(history.completed_at, history.recorded_at, history.scheduled_at, history.ordered_at, history.source_updated_at) as service_at,
         case when history.source_provider = 'local' then left(workorder.concern, ${MAX_HISTORY_TEXT_LENGTH}) else '' end as concern,
         case when history.source_provider = 'local' then length(workorder.concern) > ${MAX_HISTORY_TEXT_LENGTH} else false end as concern_truncated,
         case when history.source_provider = 'local' then left(workorder.diagnosis, ${MAX_HISTORY_TEXT_LENGTH}) else '' end as diagnosis,
         case when history.source_provider = 'local' then length(workorder.diagnosis) > ${MAX_HISTORY_TEXT_LENGTH} else false end as diagnosis_truncated,
         case
           when history.source_provider = 'local' then left(workorder.work_performed, ${MAX_HISTORY_TEXT_LENGTH})
           when history.source_provider = 'local_inspection' then left('Weekly inspection · ' || coalesce(history.raw_metadata->>'result','completed'), ${MAX_HISTORY_TEXT_LENGTH})
           else ''
         end as work_performed,
         case when history.source_provider = 'local' then length(workorder.work_performed) > ${MAX_HISTORY_TEXT_LENGTH} else false end as work_performed_truncated,
         workorder.form_data
       from service_history_orders history
       left join operational_workorders workorder
         on history.source_provider = 'local'
        and workorder.company_id = history.company_id
        and workorder.id::text = history.external_id
       where history.company_id = $1
         and history.asset_id = $2::uuid
         and (
           (history.source_provider = 'local'
             and workorder.id is not null
             and workorder.id <> $3::uuid
             and workorder.status in ('closed', 'odoo_entered')
             and workorder.closed_at is not null
             and history.completed_at is not null
             and history.completion_date_kind = 'verified_completed')
           or
           (history.source_provider = 'odoo'
             and history.status in ('sale', 'done')
             and (
               (history.completed_at is not null
                 and history.completion_date_kind = 'verified_completed')
               or history.recorded_at is not null
             )
             and not exists (
               select 1
               from odoo_entry_status entry
               join operational_workorders linked_workorder
                 on linked_workorder.id = entry.workorder_id
                and linked_workorder.company_id = history.company_id
               where (entry.external_id <> '' and entry.external_id = history.external_id)
                  or (coalesce(entry.external_id, '') = ''
                    and entry.odoo_service_order_no <> ''
                    and entry.odoo_service_order_no = history.reference)
             ))
           or
           (history.source_provider = 'local_inspection'
             and history.inspection_id is not null
             and history.completed_at is not null
             and history.completion_date_kind = 'verified_completed')
         )
     ), page as (
       select eligible.*
       from eligible
       where ($4::timestamptz is null or (eligible.service_at, eligible.id) < ($4::timestamptz, $5::uuid))
       order by eligible.service_at desc, eligible.id desc
       limit $6
     ), stats as (
       select count(*)::int as total_count,
              max(completed_at) as last_completed_service_at,
              max(recorded_at) as latest_recorded_service_at
       from eligible
     )
     select page.*,
            stats.total_count, stats.last_completed_service_at, stats.latest_recorded_service_at,
            case when page.source_provider in ('odoo','local_inspection') then coalesce(service_lines.items, '[]'::jsonb) else '[]'::jsonb end as service_lines,
            case when page.source_provider in ('odoo','local_inspection') then coalesce(service_lines.truncated, false) else false end as service_lines_truncated,
            case
              when page.source_provider = 'local' then coalesce(local_parts.items, '[]'::jsonb)
              else coalesce(provider_parts.items, '[]'::jsonb)
            end as parts,
            case
              when page.source_provider = 'local' then coalesce(local_parts.truncated, false)
              else coalesce(provider_parts.truncated, false)
            end as parts_truncated
     from stats
     left join page on true
     left join lateral (
       select jsonb_agg(left(candidate.description, ${MAX_HISTORY_LINE_TEXT_LENGTH})
                order by candidate.sequence, candidate.line_index, candidate.id)
                filter (where candidate.result_index <= ${MAX_HISTORY_SERVICE_LINES}) as items,
              count(*) > ${MAX_HISTORY_SERVICE_LINES}
                or coalesce(bool_or(length(candidate.description) > ${MAX_HISTORY_LINE_TEXT_LENGTH})
                  filter (where candidate.result_index <= ${MAX_HISTORY_SERVICE_LINES}), false) as truncated
       from (
         select line.*,
                row_number() over (order by line.sequence, line.line_index, line.id) as result_index
         from service_history_lines line
         where line.company_id = page.company_id
           and line.service_order_id = page.id
           and line.line_kind = 'service'
           and btrim(line.description) <> ''
         order by line.sequence, line.line_index, line.id
         limit ${MAX_HISTORY_SERVICE_LINES + 1}
       ) candidate
     ) service_lines on page.id is not null
     left join lateral (
       select jsonb_agg(jsonb_build_object(
         'partNumber', left(coalesce(candidate.value ->> 'partNo', ''), ${MAX_HISTORY_PART_FIELD_LENGTH}),
         'quantity', left(coalesce(candidate.value ->> 'qty', ''), ${MAX_HISTORY_PART_FIELD_LENGTH}),
         'uom', left(coalesce(candidate.value ->> 'uomCode', ''), ${MAX_HISTORY_PART_FIELD_LENGTH})
       ) order by candidate.ordinality)
       filter (where candidate.result_index <= ${MAX_HISTORY_PARTS}) as items,
       count(*) > ${MAX_HISTORY_PARTS}
         or coalesce(bool_or(
           length(coalesce(candidate.value ->> 'partNo', '')) > ${MAX_HISTORY_PART_FIELD_LENGTH}
           or length(coalesce(candidate.value ->> 'qty', '')) > ${MAX_HISTORY_PART_FIELD_LENGTH}
           or length(coalesce(candidate.value ->> 'uomCode', '')) > ${MAX_HISTORY_PART_FIELD_LENGTH}
         ) filter (where candidate.result_index <= ${MAX_HISTORY_PARTS}), false) as truncated
       from (
         select part.*,
                row_number() over (order by part.ordinality) as result_index
         from jsonb_array_elements(
           case when jsonb_typeof(page.form_data -> 'parts') = 'array'
             then page.form_data -> 'parts' else '[]'::jsonb end
         ) with ordinality part(value, ordinality)
         where btrim(coalesce(part.value ->> 'partNo', '')) <> ''
         order by part.ordinality
         limit ${MAX_HISTORY_PARTS + 1}
       ) candidate
     ) local_parts on page.id is not null and page.source_provider = 'local'
     left join lateral (
       select jsonb_agg(jsonb_build_object(
         'partNumber', left(candidate.part_number, ${MAX_HISTORY_PART_FIELD_LENGTH}),
         'name', left(candidate.product_name, ${MAX_HISTORY_PART_FIELD_LENGTH}),
         'quantity', candidate.quantity,
         'uom', left(candidate.uom, ${MAX_HISTORY_PART_FIELD_LENGTH})
       ) order by candidate.sequence, candidate.line_index, candidate.id)
       filter (where candidate.result_index <= ${MAX_HISTORY_PARTS}) as items,
       count(*) > ${MAX_HISTORY_PARTS}
         or coalesce(bool_or(
           length(candidate.part_number) > ${MAX_HISTORY_PART_FIELD_LENGTH}
           or length(candidate.product_name) > ${MAX_HISTORY_PART_FIELD_LENGTH}
           or length(candidate.uom) > ${MAX_HISTORY_PART_FIELD_LENGTH}
         ) filter (where candidate.result_index <= ${MAX_HISTORY_PARTS}), false) as truncated
       from (
         select line.*,
                row_number() over (order by line.sequence, line.line_index, line.id) as result_index
         from service_history_lines line
         where line.company_id = page.company_id
           and line.service_order_id = page.id
           and line.line_kind = 'goods'
         order by line.sequence, line.line_index, line.id
         limit ${MAX_HISTORY_PARTS + 1}
       ) candidate
     ) provider_parts on page.id is not null and page.source_provider = 'odoo'
     order by page.service_at desc, page.id desc`,
    [tenantId, assetId, currentWorkorderId, after?.serviceAt || null, after?.id || null, pageSize + 1],
  );
  const itemRows = result.rows.filter((row) => row.id);
  const hasMore = itemRows.length > pageSize;
  const rows = itemRows.slice(0, pageSize);
  const last = rows.at(-1);
  return {
    items: rows.map(publicHistoryItem),
    historyCount: Number(result.rows[0]?.total_count) || 0,
    lastCompletedServiceAt: result.rows[0]?.last_completed_service_at || null,
    latestRecordedServiceAt: result.rows[0]?.latest_recorded_service_at || null,
    nextCursor: hasMore && last ? encodeUnitHistoryCursor({ serviceAt: last.service_at, id: last.id }) : null,
  };
}
