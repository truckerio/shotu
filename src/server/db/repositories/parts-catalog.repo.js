import { query } from "../pool.js";
import { normalizePartNumber } from "../../modules/parts/part.constants.js";

function publicCatalogPart(row) {
  return {
    id: row.id,
    partNumber: row.part_number,
    normalizedPartNumber: row.normalized_part_number,
    manufacturer: row.manufacturer,
    description: row.description,
    category: row.category,
    repairOrder: row.repair_template,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    matchType: row.match_type,
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
        case
          when pc.normalized_part_number = $2 then 'exact_part_number'
          when lower(pc.part_number) = lower($3) then 'exact_part_number'
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
          or exists (
            select 1 from jsonb_array_elements_text(pc.aliases) alias
            where lower(alias) = lower($3)
          )
        )
      order by
        case
          when pc.normalized_part_number = $2 then 0
          when lower(pc.part_number) = lower($3) then 1
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
