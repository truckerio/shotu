import { query } from "../pool.js";
import { requireCompanyId } from "../company.js";
import { normalizePartNumber } from "../../modules/parts/part.constants.js";

const MAX_SUGGESTIONS = 10;
const MAX_CANDIDATE_ROWS = 500;
const MAX_EXAMPLES = 3;

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
    `select provider_watermark, last_reconciled_at
     from service_history_sync_state
     where company_id = $1 and source_provider = $2`,
    [tenantId, provider],
  );
  return {
    providerWatermark: result.rows[0]?.provider_watermark || null,
    lastReconciledAt: result.rows[0]?.last_reconciled_at || null,
  };
}

export async function markServiceHistorySyncSucceeded(companyId, provider, {
  providerWatermark,
  reconciled = false,
}) {
  const tenantId = requireCompanyId(companyId);
  await query(
    `insert into service_history_sync_state (
       company_id, source_provider, provider_watermark, last_reconciled_at, updated_at
     ) values ($1, $2, $3, case when $4 then now() else null end, now())
     on conflict (company_id, source_provider) do update
     set provider_watermark = excluded.provider_watermark,
         last_reconciled_at = case
           when $4 then now()
           else service_history_sync_state.last_reconciled_at
         end,
         updated_at = now()`,
    [tenantId, provider, providerWatermark, reconciled],
  );
}
