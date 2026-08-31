import { query } from "../pool.js";
import { normalizePartNumber } from "../../modules/parts/part.constants.js";
import { DEFAULT_UOM_CODE } from "../../../../shared/units-of-measure.js";

const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 12;

function publicQuantity(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function escapeLikePattern(value) {
  return String(value || "").replace(/[\\%_]/g, "\\$&");
}

function publicInventory(row) {
  if (!row.inventory_item_id) return null;
  return {
    itemId: row.inventory_item_id,
    locationId: row.inventory_location_id,
    locationName: row.inventory_location_name || "",
    quantityOnHand: publicQuantity(row.quantity_on_hand),
    quantityReserved: publicQuantity(row.quantity_reserved),
    available: publicQuantity(row.quantity_available),
    binLocation: row.bin_location || "",
    uomCode: row.inventory_uom_code || row.uom_code || DEFAULT_UOM_CODE,
    updatedAt: row.inventory_updated_at,
  };
}

function publicCatalogPart(row) {
  return {
    id: row.id,
    partNumber: row.part_number,
    normalizedPartNumber: row.normalized_part_number,
    manufacturer: row.manufacturer,
    description: row.description,
    category: row.category,
    uomCode: row.uom_code || DEFAULT_UOM_CODE,
    repairOrder: row.repair_template,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    referenceNumbers: Array.isArray(row.reference_numbers) ? row.reference_numbers : [],
    version: Number(row.version || 1),
    matchType: row.match_type,
    matchRank: row.match_rank === undefined ? undefined : Number(row.match_rank),
    barcode: row.barcode || "",
    source: row.inventory_item_id ? "local" : (row.source_provider || (row.odoo_external_id ? "odoo" : "company")),
    externalId: row.odoo_external_id || row.external_id || "",
    providerUpdatedAt: row.provider_updated_at || null,
    lastSeenAt: row.last_seen_at || null,
    providerManaged: row.provider_managed === true || Boolean(row.odoo_external_id),
    editableFields: row.provider_managed === true || row.odoo_external_id
      ? ["manufacturer", "referenceNumbers"]
      : ["description", "partNumber", "manufacturer", "category", "barcode", "referenceNumbers"],
    inventory: publicInventory(row),
  };
}

/**
 * Search one company's durable catalog. Supports both
 *   searchCompanyCatalogParts(companyId, { text, locationId, limit })
 * and
 *   searchCompanyCatalogParts(companyId, text, { locationId, limit }).
 */
export async function searchCompanyCatalogParts(companyId, input, options = {}) {
  const values = typeof input === "object" && input !== null
    ? input
    : { ...options, text: input };
  const text = String(values.text || "").trim();
  if (!companyId || text.length < 2) return { catalogAvailable: false, items: [] };

  const normalized = normalizePartNumber(text);
  const escapedText = escapeLikePattern(text.toLocaleLowerCase("en-US"));
  const escapedNormalized = escapeLikePattern(normalized);
  const allowBroadTextMatch = text.length >= 3;
  const textMatchPattern = allowBroadTextMatch ? `%${escapedText}%` : `${escapedText}%`;
  const normalizedMatchPattern = allowBroadTextMatch ? `%${escapedNormalized}%` : `${escapedNormalized}%`;
  const limit = Math.min(MAX_SEARCH_LIMIT, Math.max(1, Number.parseInt(values.limit, 10) || DEFAULT_SEARCH_LIMIT));
  const locationId = values.locationId || null;
  const purpose = ["issue", "request", "master_match", "workorder_assignment"].includes(values.purpose) ? values.purpose : "request";

  const result = await query(
    `
      with catalog_state as (
        select exists (
          select 1 from parts_catalog where company_id = $1
        ) as catalog_available
      ), candidates as (
        select
          pc.*,
          case
            when $2 <> '' and pc.normalized_part_number = $2 then 0
            when exists (
              select 1 from odoo_product_mappings exact_barcode
              where exact_barcode.company_id = pc.company_id
                and exact_barcode.catalog_part_id = pc.id
                and lower(exact_barcode.barcode) = $3
            ) then 1
            when exists (select 1 from part_reference_numbers reference where reference.company_id=pc.company_id and reference.catalog_part_id=pc.id and reference.normalized_reference_number=$2) then 2
            when exists (
              select 1 from jsonb_array_elements_text(pc.aliases) alias
              where lower(alias) = $3
            ) then 3
            when ($2 <> '' and pc.normalized_part_number like $4 escape '\\')
              or lower(pc.part_number) like $5 escape '\\' then 3
            when exists (
              select 1 from odoo_product_mappings prefix_barcode
              where prefix_barcode.company_id = pc.company_id
                and prefix_barcode.catalog_part_id = pc.id
                and lower(prefix_barcode.barcode) like $5 escape '\\'
            ) then 4
            when lower(pc.description) = $3 then 5
            when lower(pc.description) like $6 escape '\\'
              or lower(pc.manufacturer) like $6 escape '\\'
              or lower(pc.category) like $6 escape '\\' then 6
            else 7
          end as match_rank,
          case
            when $2 <> '' and pc.normalized_part_number = $2 then 'exact_part_number'
            when exists (
              select 1 from odoo_product_mappings exact_barcode
              where exact_barcode.company_id = pc.company_id
                and exact_barcode.catalog_part_id = pc.id
                and lower(exact_barcode.barcode) = $3
            ) then 'exact_barcode'
            when exists (select 1 from part_reference_numbers reference where reference.company_id=pc.company_id and reference.catalog_part_id=pc.id and reference.normalized_reference_number=$2) then 'exact_reference_number'
            when exists (
              select 1 from jsonb_array_elements_text(pc.aliases) alias
              where lower(alias) = $3
            ) then 'exact_alias'
            when ($2 <> '' and pc.normalized_part_number like $4 escape '\\')
              or lower(pc.part_number) like $5 escape '\\' then 'part_prefix'
            when exists (
              select 1 from odoo_product_mappings prefix_barcode
              where prefix_barcode.company_id = pc.company_id
                and prefix_barcode.catalog_part_id = pc.id
                and lower(prefix_barcode.barcode) like $5 escape '\\'
            ) then 'barcode_prefix'
            when lower(pc.description) = $3 then 'exact_description'
            when lower(pc.description) like $6 escape '\\'
              or lower(pc.manufacturer) like $6 escape '\\'
              or lower(pc.category) like $6 escape '\\' then 'text_match'
            else 'related'
          end as match_type
        from parts_catalog pc
        where pc.company_id = $1
          and (
            ($2 <> '' and pc.normalized_part_number like $7 escape '\\')
            or lower(pc.part_number) like $6 escape '\\'
            or exists (
              select 1 from odoo_product_mappings matching_barcode
              where matching_barcode.company_id = pc.company_id
                and matching_barcode.catalog_part_id = pc.id
                and lower(matching_barcode.barcode) like $6 escape '\\'
            )
            or lower(pc.description) = $3
            or exists (select 1 from part_reference_numbers reference where reference.company_id = pc.company_id and reference.catalog_part_id = pc.id and lower(reference.reference_number) like $6 escape '\\')
            or exists (select 1 from part_reference_numbers reference where reference.company_id = pc.company_id and reference.catalog_part_id = pc.id and $2 <> '' and reference.normalized_reference_number like $4 escape '\\')
            or exists (
              select 1 from jsonb_array_elements_text(pc.aliases) alias
              where lower(alias) = $3
            )
            or ($10::boolean and (
              lower(pc.description) like $6 escape '\\'
              or lower(pc.manufacturer) like $6 escape '\\'
              or lower(pc.category) like $6 escape '\\'
              or lower(pc.aliases::text) like $6 escape '\\'
            ))
          )
      )
      select
        candidates.*,
        coalesce((select jsonb_agg(reference.reference_number order by lower(reference.reference_number), reference.id) from part_reference_numbers reference where reference.company_id=candidates.company_id and reference.catalog_part_id=candidates.id), '[]'::jsonb) as reference_numbers,
        exists (select 1 from odoo_product_mappings ownership where ownership.company_id=candidates.company_id and ownership.catalog_part_id=candidates.id) as provider_managed,
        provider.external_id as odoo_external_id,
        provider.barcode,
        provider.active as provider_active,
        provider.provider_updated_at,
        provider.last_seen_at,
        case when inventory.id is not null then 'local'
          when provider.external_id is not null then 'odoo'
          else candidates.source_provider end as source_provider,
        inventory.id as inventory_item_id,
        inventory.location_id as inventory_location_id,
        inventory.location_name as inventory_location_name,
        inventory.quantity_on_hand,
        inventory.quantity_reserved,
        inventory.quantity_available,
        inventory.bin_location,
        inventory.uom_code as inventory_uom_code,
        inventory.updated_at as inventory_updated_at,
        catalog_state.catalog_available
      from catalog_state
      left join candidates on true
      left join lateral (
        select mapping.*
        from odoo_product_mappings mapping
        where mapping.company_id = candidates.company_id
          and mapping.catalog_part_id = candidates.id
        order by mapping.active desc, mapping.last_seen_at desc, mapping.updated_at desc
        limit 1
      ) provider on true
      left join lateral (
        select
          item.id,
          item.location_id,
          location.name as location_name,
          item.quantity_on_hand,
          item.quantity_reserved,
          greatest(item.quantity_on_hand - item.quantity_reserved, 0) as quantity_available,
          item.bin_location,
          item.uom_code,
          item.updated_at
        from inventory_items item
        left join locations location
          on location.id = item.location_id
          and location.company_id = item.company_id
        where $8::uuid is not null
          and item.company_id = candidates.company_id
          and item.source_provider = 'local'
          and item.catalog_part_id = candidates.id
          and item.location_id = $8::uuid
          and item.uom_code = candidates.uom_code
        order by (item.quantity_on_hand - item.quantity_reserved) desc, item.updated_at desc
        limit 1
      ) inventory on true
      where candidates.id is null
        or $11::text in ('master_match', 'workorder_assignment')
        or (
          inventory.id is not null
          and ($11::text = 'request' or inventory.quantity_available > 0)
        )
      order by
        candidates.match_rank,
        (coalesce(inventory.quantity_available, 0) > 0) desc,
        coalesce(provider.active, false) desc,
        coalesce(provider.last_seen_at, candidates.updated_at) desc,
        candidates.part_number asc
      limit $9
    `,
    [
      companyId,
      normalized,
      text.toLocaleLowerCase("en-US"),
      `${escapedNormalized}%`,
      `${escapedText}%`,
      textMatchPattern,
      normalizedMatchPattern,
      locationId,
      limit,
      allowBroadTextMatch,
      purpose,
    ],
  );

  return {
    catalogAvailable: result.rows[0]?.catalog_available ?? false,
    items: result.rows.filter((row) => row.id).map(publicCatalogPart),
  };
}

export async function findCompanyCatalogPart(companyId, input) {
  const text = String(input || "").trim();
  if (!companyId || text.length < 2) return null;
  const normalized = normalizePartNumber(text);
  const result = await query(
    `
      select
        pc.*,
        coalesce((select jsonb_agg(reference.reference_number order by lower(reference.reference_number), reference.id) from part_reference_numbers reference where reference.company_id=pc.company_id and reference.catalog_part_id=pc.id), '[]'::jsonb) as reference_numbers,
        exists (select 1 from odoo_product_mappings ownership where ownership.company_id=pc.company_id and ownership.catalog_part_id=pc.id) as provider_managed,
        case
          when pc.normalized_part_number = $2 then 'exact_part_number'
          when lower(pc.part_number) = lower($3) then 'exact_part_number'
          when exists (select 1 from part_reference_numbers reference where reference.company_id=pc.company_id and reference.catalog_part_id=pc.id and reference.normalized_reference_number=$2) then 'exact_reference_number'
          when exists (
            select 1 from jsonb_array_elements_text(pc.aliases) alias
            where lower(alias) = lower($3)
          ) then 'exact_alias'
          when lower(pc.description) = lower($3) then 'exact_description'
          else 'related'
        end as match_type
      from parts_catalog pc
      where pc.company_id = $1
        and (
          pc.normalized_part_number = $2
          or lower(pc.part_number) = lower($3)
          or lower(pc.description) = lower($3)
          or exists (select 1 from part_reference_numbers reference where reference.company_id=pc.company_id and reference.catalog_part_id=pc.id and reference.normalized_reference_number=$2)
          or exists (
            select 1 from jsonb_array_elements_text(pc.aliases) alias
            where lower(alias) = lower($3)
          )
        )
      order by
        case
          when pc.normalized_part_number = $2 then 0
          when lower(pc.part_number) = lower($3) then 1
          when exists (select 1 from part_reference_numbers reference where reference.company_id=pc.company_id and reference.catalog_part_id=pc.id and reference.normalized_reference_number=$2) then 2
          when exists (
            select 1 from jsonb_array_elements_text(pc.aliases) alias
            where lower(alias) = lower($3)
          ) then 2
          else 3
        end,
        pc.updated_at desc
      limit 1
    `,
    [companyId, normalized, text],
  );
  return result.rows[0] ? publicCatalogPart(result.rows[0]) : null;
}
