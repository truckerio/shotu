import { query } from "../pool.js";

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
  a.year as "year"
`;

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

export async function listUnitsDirectory({ companyIds, locationIds, isAdmin, q, unitType, limit, cursor }, dependencies = {}) {
  if (!companyIds.length || (!isAdmin && !locationIds.length)) return { items: [], nextCursor: null };
  const after = decodeUnitsDirectoryCursor(cursor);
  const escaped = `%${q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const runQuery = dependencies.query || query;
  const result = await runQuery(
    `
      select ${IDENTITY_FIELDS},
             coalesce(nullif(a.unit_no, ''), nullif(a.name, ''), nullif(a.vin, ''), nullif(a.license_plate, ''), '') as "sortKey"
      from assets a
      where a.company_id = any($1::uuid[])
        and ($2::boolean or a.location_id = any($3::uuid[]))
        and ($4::text is null or a.unit_type = $4)
        and (
          $5::text = ''
          or a.unit_no ilike $6 escape '\\'
          or a.name ilike $6 escape '\\'
          or a.vin ilike $6 escape '\\'
          or a.license_plate ilike $6 escape '\\'
        )
        and (
          $7::text is null
          or coalesce(nullif(a.unit_no, ''), nullif(a.name, ''), nullif(a.vin, ''), nullif(a.license_plate, ''), '') > $7
          or (
            coalesce(nullif(a.unit_no, ''), nullif(a.name, ''), nullif(a.vin, ''), nullif(a.license_plate, ''), '') = $7
            and a.id > $8::uuid
          )
        )
      order by coalesce(nullif(a.unit_no, ''), nullif(a.name, ''), nullif(a.vin, ''), nullif(a.license_plate, ''), ''), a.id
      limit $9
    `,
    [companyIds, isAdmin, locationIds, unitType || null, q, escaped, after?.sortKey ?? null, after?.id ?? null, limit + 1],
  );
  const rows = result.rows;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(({ sortKey, ...item }) => item),
    nextCursor: rows.length > limit && last ? encodeUnitsDirectoryCursor(last) : null,
  };
}
