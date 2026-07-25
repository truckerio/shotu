import { query } from "../pool.js";

const templateColumns = `
  template.id,
  template.location_id,
  template.header_title,
  template.brand_top,
  template.brand_bottom,
  template.warranty_text,
  template.responsibility_text,
  template.authorization_text,
  template.active,
  template.version,
  template.updated_at
`;

export async function upsertLocationTemplate(locationId, input, actorId) {
  const result = await query(
    `insert into location_workorder_templates (
       location_id, header_title, brand_top, brand_bottom, warranty_text,
       responsibility_text, authorization_text, updated_by_user_id
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (location_id) do update
       set header_title = excluded.header_title,
           brand_top = excluded.brand_top,
           brand_bottom = excluded.brand_bottom,
           warranty_text = excluded.warranty_text,
           responsibility_text = excluded.responsibility_text,
           authorization_text = excluded.authorization_text,
           active = true,
           version = location_workorder_templates.version + 1,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_at = now()
     returning ${templateColumns.replaceAll("template.", "")}`,
    [locationId, input.headerTitle, input.brandTop, input.brandBottom, input.warrantyText, input.responsibilityText, input.authorizationText, actorId],
  );
  return result.rows[0];
}

export async function getLocationTemplate(locationId) {
  const result = await query(
    `select ${templateColumns}
       from location_workorder_templates template
      where template.location_id = $1 and template.active = true
      limit 1`,
    [locationId],
  );
  return result.rows[0] || null;
}

export async function getLocationTemplates(locationIds) {
  if (!locationIds?.length) return [];
  const result = await query(
    `select
       location.id as location_id,
       location.company_id,
       location.name as location_name,
       location.type as location_type,
       location.address as location_address,
       ${templateColumns}
     from locations location
     left join location_workorder_templates template
       on template.location_id = location.id and template.active = true
     where location.id = any($1::uuid[]) and location.active = true
     order by location.name`,
    [locationIds],
  );
  return result.rows;
}
