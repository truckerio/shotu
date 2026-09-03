import { query } from "../pool.js";
import { requireCompanyId } from "../company.js";

export async function searchVehicles(searchText, limit = 12, companyIds = []) {
  const q = String(searchText || "").trim();
  if (q.length < 2 || !companyIds.length) return [];
  const qKey = q.toLowerCase().replace(/[^a-z0-9]/g, "");
  const like = `%${q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const result = await query(
    `
      select a.id, a.company_id, a.provider, a.provider_vehicle_id, a.unit_type, a.owner_name, a.name, a.unit_no, a.vin, a.license_plate,
             a.make, a.model, a.year, a.serial, a.tag_names, a.last_odometer_meters, a.last_odometer_miles,
             a.last_location, a.last_seen_at, a.synced_at,
             case when active_workorder.id is null then null else jsonb_build_object(
               'id', active_workorder.id,
               'serial', active_workorder.serial,
               'status', active_workorder.status
             ) end as active_workorder
      from assets a
      left join lateral (
        select wo.id, wo.serial, wo.status
        from operational_workorders wo
        where wo.asset_id = a.id
          and wo.company_id = a.company_id
          and wo.status not in ('closed', 'odoo_entered', 'cancelled')
        order by wo.created_at desc, wo.id desc
        limit 1
      ) active_workorder on true
      where a.company_id = any($5::uuid[])
        and (
          a.unit_no ilike $1 escape '\\'
          or a.name ilike $1 escape '\\'
          or a.vin ilike $1 escape '\\'
          or a.license_plate ilike $1 escape '\\'
          or a.serial ilike $1 escape '\\'
        )
      order by
        case
          when regexp_replace(lower(coalesce(a.unit_no, '')), '[^a-z0-9]', '', 'g') = $4 and a.unit_type = 'Trailer' then -2
          when regexp_replace(lower(coalesce(a.name, '')), '[^a-z0-9]', '', 'g') = $4 and a.unit_type = 'Trailer' then -2
          when regexp_replace(lower(coalesce(a.unit_no, '')), '[^a-z0-9]', '', 'g') = $4 then -1
          when regexp_replace(lower(coalesce(a.name, '')), '[^a-z0-9]', '', 'g') = $4 then -1
          when a.unit_no ilike $2 then 0
          when a.name ilike $2 then 1
          when a.vin ilike $2 then 2
          else 3
        end,
        coalesce(a.unit_no, a.name, a.vin, a.license_plate)
      limit $3
    `,
    [like, `${q}%`, Math.max(1, Math.min(Number(limit) || 12, 25)), qKey, companyIds]
  );
  return result.rows;
}

export async function getVehicleById(id, companyIds = []) {
  if (!companyIds.length) return null;
  const result = await query(
    `
      select a.id, a.company_id, a.provider, a.provider_vehicle_id, a.unit_type, a.owner_name, a.name, a.unit_no, a.vin, a.license_plate,
             a.make, a.model, a.year, a.serial, a.tag_names, a.last_odometer_meters, a.last_odometer_miles,
             a.last_location, a.last_seen_at, a.synced_at,
             case when active_workorder.id is null then null else jsonb_build_object(
               'id', active_workorder.id,
               'serial', active_workorder.serial,
               'status', active_workorder.status
             ) end as active_workorder
      from assets a
      left join lateral (
        select wo.id, wo.serial, wo.status
        from operational_workorders wo
        where wo.asset_id = a.id
          and wo.company_id = a.company_id
          and wo.status not in ('closed', 'odoo_entered', 'cancelled')
        order by wo.created_at desc, wo.id desc
        limit 1
      ) active_workorder on true
      where a.id = $1 and a.company_id = any($2::uuid[])
    `,
    [id, companyIds]
  );
  return result.rows[0] || null;
}

export async function findVehicleIdentityDuplicates({ companyId, unitNo = "", vin = "", licensePlate = "" }) {
  const result = await query(
    `
      select a.id, a.company_id, a.location_id, a.provider, a.unit_type, a.name, a.unit_no, a.vin, a.license_plate
      from assets a
      where a.company_id = $1
        and (
          ($2 <> '' and regexp_replace(lower(coalesce(a.unit_no, '')), '[^a-z0-9]', '', 'g') = $2)
          or ($3 <> '' and regexp_replace(lower(coalesce(a.vin, '')), '[^a-z0-9]', '', 'g') = $3)
          or ($4 <> '' and regexp_replace(lower(coalesce(a.license_plate, '')), '[^a-z0-9]', '', 'g') = $4)
        )
      order by a.updated_at desc, a.id desc
      limit 10
    `,
    [companyId, unitNo, vin, licensePlate],
  );
  return result.rows;
}

export async function createManualVehicle({ companyId, locationId, unitType, unitNo, vin = "", licensePlate = "", name = "" }) {
  const result = await query(
    `
      insert into assets (company_id, location_id, provider, unit_type, name, unit_no, vin, license_plate)
      values ($1, $2, 'manual', $3, $4, $5, nullif($6, ''), nullif($7, ''))
      returning id, company_id, location_id, provider, unit_type, name, unit_no, vin, license_plate
    `,
    [companyId, locationId, unitType, name || unitNo, unitNo, vin, licensePlate],
  );
  return result.rows[0] || null;
}

export async function updateVehicleLocation(id, companyId, location, seenAt) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `
      update assets
      set last_location = $3::jsonb,
          last_seen_at = $4,
          updated_at = now()
      where id = $1
        and company_id = $2
      returning id, company_id, provider, provider_vehicle_id, unit_type, owner_name, name, unit_no, vin, license_plate,
                make, model, year, serial, tag_names, last_odometer_meters, last_odometer_miles,
                last_location, last_seen_at, synced_at
    `,
    [id, tenantId, JSON.stringify(location || {}), seenAt || null]
  );
  return result.rows[0] || null;
}

export async function upsertVehicles(vehicles, companyId) {
  const tenantId = requireCompanyId(companyId);
  let changedCount = 0;
  for (const vehicle of vehicles) {
    const result = await query(
      `
        insert into assets (
          company_id, provider, provider_vehicle_id, unit_type, owner_name, name, unit_no, vin, license_plate,
          make, model, year, serial, tag_names, external_ids, raw_provider_data,
          last_odometer_meters, last_odometer_miles, last_location, last_seen_at,
          synced_at, updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16::jsonb,
          $17, $18, $19::jsonb, $20,
          now(), now()
        )
        on conflict (company_id, provider, provider_vehicle_id)
        where provider_vehicle_id is not null
        do update set
          name = excluded.name,
          unit_type = excluded.unit_type,
          owner_name = excluded.owner_name,
          unit_no = excluded.unit_no,
          vin = excluded.vin,
          license_plate = excluded.license_plate,
          make = excluded.make,
          model = excluded.model,
          year = excluded.year,
          serial = excluded.serial,
          tag_names = excluded.tag_names,
          external_ids = excluded.external_ids,
          raw_provider_data = excluded.raw_provider_data,
          last_odometer_meters = coalesce(excluded.last_odometer_meters, assets.last_odometer_meters),
          last_odometer_miles = coalesce(excluded.last_odometer_miles, assets.last_odometer_miles),
          last_location = coalesce(excluded.last_location, assets.last_location),
          last_seen_at = coalesce(excluded.last_seen_at, assets.last_seen_at),
          synced_at = now(),
          updated_at = now()
        returning id
      `,
      [
        tenantId,
        vehicle.provider,
        vehicle.providerVehicleId,
        vehicle.unitType,
        vehicle.ownerName,
        vehicle.name,
        vehicle.unitNo,
        vehicle.vin,
        vehicle.licensePlate,
        vehicle.make,
        vehicle.model,
        vehicle.year,
        vehicle.serial,
        JSON.stringify(vehicle.tagNames || []),
        JSON.stringify(vehicle.externalIds || {}),
        JSON.stringify(vehicle.raw || {}),
        vehicle.lastOdometerMeters,
        vehicle.lastOdometerMiles,
        vehicle.lastLocation ? JSON.stringify(vehicle.lastLocation) : null,
        vehicle.lastSeenAt,
      ]
    );
    changedCount += result.rowCount;
  }
  return changedCount;
}
