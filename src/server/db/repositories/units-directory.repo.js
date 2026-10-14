import { query } from "../pool.js";
import { classifyUnitTag } from "../../modules/vehicles/unit-tag-classification.js";

const IDENTITY_FIELDS = `
  a.id as "id",
  a.company_id as "companyId",
  a.location_id as "locationId",
  coalesce(
    (
      select usage.location_id
      from workorder_serialized_part_usages usage
      where usage.company_id = a.company_id
        and usage.asset_id = a.id
        and usage.status in ('installed_pending_approval', 'installed', 'removed')
      order by
        case when usage.status in ('installed_pending_approval', 'installed') then 0 else 1 end,
        usage.issued_at desc,
        usage.id desc
      limit 1
    ),
    a.location_id
  ) as "custodyLocationId",
  a.unit_no as "unitNo",
  a.unit_type as "unitType",
  a.name as "name",
  a.vin as "vin",
  a.license_plate as "licensePlate",
  a.make as "make",
  a.model as "model",
  a.year as "year",
  a.tag_names as "tagNames",
  case when active_workorder.id is null then null else jsonb_build_object(
    'id', active_workorder.id,
    'serial', active_workorder.serial,
    'status', active_workorder.status
  ) end as "activeWorkorder"
`;

const ACTIVE_WORKORDER_JOIN = `
  left join lateral (
    select workorder.id, workorder.serial, workorder.status
    from operational_workorders workorder
    where workorder.asset_id = a.id
      and workorder.company_id = a.company_id
      and workorder.status not in ('closed', 'odoo_entered', 'cancelled')
    order by workorder.created_at desc, workorder.id desc
    limit 1
  ) active_workorder on true
`;

const UNIT_SORT_KEY = "coalesce(nullif(a.unit_no, ''), nullif(a.name, ''), nullif(a.vin, ''), nullif(a.license_plate, ''), '')";
const UNIT_DIRECTORY_SORTS = Object.freeze({
  unit_asc: { direction: "asc", operator: ">", expression: UNIT_SORT_KEY },
  unit_desc: { direction: "desc", operator: "<", expression: UNIT_SORT_KEY },
  tags_asc: {
    direction: "asc",
    operator: ">",
    expression: `coalesce(a.tag_names->>0, '') || '|' || ${UNIT_SORT_KEY}`,
  },
  repair_first: {
    direction: "asc",
    operator: ">",
    expression: `(case when active_workorder.id is null then '1' else '0' end) || '|' || ${UNIT_SORT_KEY}`,
  },
});

function unitTypeSql(parameter) {
  return `(
    ${parameter}::text is null
    or (${parameter} <> 'Other' and a.unit_type = ${parameter})
    or (${parameter} = 'Other' and coalesce(a.unit_type, '') not in ('Truck', 'Trailer'))
  )`;
}

function cursorError() {
  const error = new Error("Invalid units directory cursor.");
  error.statusCode = 400;
  error.code = "INVALID_UNITS_DIRECTORY_CURSOR";
  return error;
}

export function decodeUnitsDirectoryCursor(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid cursor encoding");
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length !== 2 || !("sortKey" in parsed) || !("id" in parsed) || typeof parsed.sortKey !== "string" || !parsed.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)) throw new Error("invalid cursor");
    return parsed;
  } catch {
    throw cursorError();
  }
}

export function encodeUnitsDirectoryCursor(row) {
  return Buffer.from(JSON.stringify({ sortKey: row.sortKey, id: row.id }), "utf8").toString("base64url");
}

export async function listUnitsDirectory({ companyIds, adminCompanyIds = [], locationIds, q, unitType, companyTag = "", routeTag = "", repair = "all", sort = "unit_asc", limit, cursor, page }, dependencies = {}) {
  const exactPage = Number.isInteger(page) ? page : null;
  if (!companyIds.length || (!adminCompanyIds.length && !locationIds.length)) return exactPage
    ? { items: [], total: 0, page: exactPage, pageCount: 0, nextCursor: null }
    : { items: [], nextCursor: null };
  const after = decodeUnitsDirectoryCursor(cursor);
  const escaped = `%${q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const runQuery = dependencies.query || query;
  const selectedSort = UNIT_DIRECTORY_SORTS[sort] || UNIT_DIRECTORY_SORTS.unit_asc;
  const sortKeySql = selectedSort.expression;
  const sortDirectionSql = selectedSort.direction;
  const cursorOperatorSql = selectedSort.operator;
  const filteredSql = `
      where a.company_id = any($1::uuid[])
        and (a.company_id = any($2::uuid[]) or a.location_id = any($3::uuid[]))
        and ${unitTypeSql("$4")}
        and (
          $5::text = ''
          or a.unit_no ilike $6 escape '\\'
          or a.name ilike $6 escape '\\'
          or a.vin ilike $6 escape '\\'
          or a.license_plate ilike $6 escape '\\'
        )
        and ($7::text = '' or a.tag_names ? $7)
        and ($8::text = '' or a.tag_names ? $8)
        and (
          $9::text = 'all'
          or ($9 = 'under_repair' and active_workorder.id is not null)
          or ($9 = 'available' and active_workorder.id is null)
        )`;
  const result = await runQuery(
    exactPage ? `
      with filtered as (
        select ${IDENTITY_FIELDS},
               ${sortKeySql} as "sortKey"
        from assets a
        ${ACTIVE_WORKORDER_JOIN}
        ${filteredSql}
      ), paged as (
        select * from filtered order by "sortKey" ${sortDirectionSql}, id ${sortDirectionSql} limit $10 offset $11
      )
      select paged.*, totals."__total"
      from (select count(*)::int as "__total" from filtered) totals
      left join paged on true
      order by paged."sortKey" ${sortDirectionSql}, paged.id ${sortDirectionSql}
    ` : `
      select ${IDENTITY_FIELDS},
             ${sortKeySql} as "sortKey"
      from assets a
      ${ACTIVE_WORKORDER_JOIN}
      ${filteredSql}
        and (
          $10::text is null
          or ${sortKeySql} ${cursorOperatorSql} $10
          or (
            ${sortKeySql} = $10
            and a.id ${cursorOperatorSql} $11::uuid
          )
        )
      order by ${sortKeySql} ${sortDirectionSql}, a.id ${sortDirectionSql}
      limit $12
    `,
    exactPage
      ? [companyIds, adminCompanyIds, locationIds, unitType || null, q, escaped, companyTag, routeTag, repair, limit, (exactPage - 1) * limit]
      : [companyIds, adminCompanyIds, locationIds, unitType || null, q, escaped, companyTag, routeTag, repair, after?.sortKey ?? null, after?.id ?? null, limit + 1],
  );
  const rows = result.rows;
  if (exactPage) {
    const total = Number(rows[0]?.__total || 0);
    return {
      items: rows.filter((row) => row.id).map(({ sortKey, __total, ...item }) => item),
      total,
      page: exactPage,
      pageCount: Math.ceil(total / limit),
      nextCursor: null,
    };
  }
  const cursorPage = rows.slice(0, limit);
  const last = cursorPage.at(-1);
  return {
    items: cursorPage.map(({ sortKey, ...item }) => item),
    nextCursor: rows.length > limit && last ? encodeUnitsDirectoryCursor(last) : null,
  };
}

export async function listUnitsDirectoryFacets({ companyIds, adminCompanyIds = [], locationIds, unitType }, dependencies = {}) {
  if (!companyIds.length || (!adminCompanyIds.length && !locationIds.length)) return { companyTags: [], routeTags: [] };
  const runQuery = dependencies.query || query;
  const result = await runQuery(
    `
      select tag.value as name, count(*)::int as count
      from assets a
      cross join lateral jsonb_array_elements_text(a.tag_names) tag(value)
      where a.company_id = any($1::uuid[])
        and (a.company_id = any($2::uuid[]) or a.location_id = any($3::uuid[]))
        and ${unitTypeSql("$4")}
      group by tag.value
      order by lower(tag.value), tag.value
    `,
    [companyIds, adminCompanyIds, locationIds, unitType || null],
  );
  const tags = result.rows
    .filter((row) => typeof row.name === "string" && row.name.trim())
    .map((row) => ({ name: row.name.trim(), count: Number(row.count) || 0 }));
  return {
    companyTags: tags.filter((tag) => classifyUnitTag(tag.name) === "company"),
    routeTags: tags.filter((tag) => classifyUnitTag(tag.name) === "route"),
  };
}
