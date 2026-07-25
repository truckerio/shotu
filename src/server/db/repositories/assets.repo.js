import { query } from "../pool.js";
import { DEFAULT_COMPANY_ID } from "../company.js";

export async function searchVehicles(searchText, limit = 12, companyIds = [DEFAULT_COMPANY_ID]) {
  const q = String(searchText || "").trim();
  if (q.length < 2) return [];
  const qKey = q.toLowerCase().replace(/[^a-z0-9]/g, "");
  const like = `%${q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const result = await query(
    `
      select id, company_uuid as company_id, provider, provider_vehicle_id, unit_type, owner_name, name, unit_no, vin, license_plate,
             make, model, year, serial, last_odometer_meters, last_odometer_miles,
             last_location, last_seen_at, synced_at
      from assets
      where company_uuid = any($5::uuid[])
        and (
          unit_no ilike $1 escape '\\'
          or name ilike $1 escape '\\'
          or vin ilike $1 escape '\\'
          or license_plate ilike $1 escape '\\'
          or serial ilike $1 escape '\\'
        )
      order by
        case
          when regexp_replace(lower(coalesce(unit_no, '')), '[^a-z0-9]', '', 'g') = $4 and unit_type = 'Trailer' then -2
          when regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]', '', 'g') = $4 and unit_type = 'Trailer' then -2
          when regexp_replace(lower(coalesce(unit_no, '')), '[^a-z0-9]', '', 'g') = $4 then -1
          when regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]', '', 'g') = $4 then -1
          when unit_no ilike $2 then 0
          when name ilike $2 then 1
          when vin ilike $2 then 2
          else 3
        end,
        coalesce(unit_no, name, vin, license_plate)
      limit $3
    `,
    [like, `${q}%`, Math.max(1, Math.min(Number(limit) || 12, 25)), qKey, companyIds]
  );
  return result.rows;
}

export async function getVehicleById(id, companyIds = [DEFAULT_COMPANY_ID]) {
  const result = await query(
    `
      select id, company_uuid as company_id, provider, provider_vehicle_id, unit_type, owner_name, name, unit_no, vin, license_plate,
             make, model, year, serial, last_odometer_meters, last_odometer_miles,
             last_location, last_seen_at, synced_at
      from assets
      where id = $1 and company_uuid = any($2::uuid[])
    `,
    [id, companyIds]
  );
  return result.rows[0] || null;
}

export async function updateVehicleLocation(id, location, seenAt) {
  const result = await query(
    `
      update assets
      set last_location = $2::jsonb,
          last_seen_at = $3,
          updated_at = now()
      where id = $1
      returning id, company_uuid as company_id, provider, provider_vehicle_id, unit_type, owner_name, name, unit_no, vin, license_plate,
                make, model, year, serial, last_odometer_meters, last_odometer_miles,
                last_location, last_seen_at, synced_at
    `,
    [id, JSON.stringify(location || {}), seenAt || null]
  );
  return result.rows[0] || null;
}

export async function upsertVehicles(vehicles, companyId = DEFAULT_COMPANY_ID) {
  let changedCount = 0;
  for (const vehicle of vehicles) {
    const result = await query(
      `
        insert into assets (
          company_uuid, provider, provider_vehicle_id, unit_type, owner_name, name, unit_no, vin, license_plate,
          make, model, year, serial, external_ids, raw_provider_data,
          last_odometer_meters, last_odometer_miles, last_location, last_seen_at,
          synced_at, updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14::jsonb, $15::jsonb,
          $16, $17, $18::jsonb, $19,
          now(), now()
        )
        on conflict (company_uuid, provider, provider_vehicle_id)
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
        companyId,
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
