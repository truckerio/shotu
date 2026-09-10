import { getPool } from "../pool.js";
import { normalizePartNumber } from "../../modules/parts/part.constants.js";

function preferredUom(row) { return row.inventory_display_uom_code || row.uom_code; }

function state(row, references) {
  return { description: row.description, partNumber: row.part_number, manufacturer: row.manufacturer,
    category: row.category, barcode: row.barcode, uomCode: preferredUom(row), trackingMode: row.tracking_mode, referenceNumbers: references };
}

function editableFields(providerManaged, uomLocked) {
  if (providerManaged) return ["description", "manufacturer", "uomCode", "trackingMode", "referenceNumbers"];
  return ["description", "partNumber", "manufacturer", "category", "barcode", "uomCode", "trackingMode", "referenceNumbers"];
}

export async function lockCompanyPartIdentity(client, companyId) {
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`part-catalog-identities:${companyId}`]);
}

export async function assertPrimaryPartIdentityAvailable(client, companyId, normalizedPartNumber) {
  await lockCompanyPartIdentity(client, companyId);
  const conflict = await client.query(
    "select 1 from part_reference_numbers where company_id=$1 and normalized_reference_number=$2 limit 1",
    [companyId, normalizedPartNumber],
  );
  if (conflict.rows[0]) {
    const error = new Error("Part number conflicts with an existing reference number.");
    error.code = "PART_CATALOG_IDENTITY_CONFLICT";
    throw error;
  }
}

export async function createCompanyCatalogPart({ companyId, actorId: _actorId, description, partNumber, manufacturer, category, barcode, uomCode, trackingMode, referenceNumbers }) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await lockCompanyPartIdentity(client, companyId);
    const normalizedPartNumber = normalizePartNumber(partNumber);
    const normalizedReferences = referenceNumbers.map(normalizePartNumber);
    const identities = [normalizedPartNumber, ...normalizedReferences];
    const normalizedBarcode = normalizePartNumber(barcode);
    const conflict = await client.query(
      `select 1 from parts_catalog c where c.company_id=$1 and c.normalized_part_number=any($2::text[])
       union all select 1 from part_reference_numbers r where r.company_id=$1 and r.normalized_reference_number=any($2::text[])
       union all select 1 from parts_catalog c where c.company_id=$1 and lower(c.barcode)=lower($3) and $3<>''
       union all select 1 from odoo_product_mappings m where m.company_id=$1 and (upper(regexp_replace(coalesce(m.default_code,''),'[^A-Za-z0-9]','','g'))=any($2::text[]) or upper(regexp_replace(coalesce(m.barcode,''),'[^A-Za-z0-9]','','g'))=any($2::text[]) or (lower(m.barcode)=lower($3) and $3<>''))
       union all select 1 from parts_catalog c where c.company_id=$1 and c.normalized_part_number=$4 and $4<>''
       union all select 1 from part_reference_numbers r where r.company_id=$1 and r.normalized_reference_number=$4 and $4<>'' limit 1`,
      [companyId, identities, barcode, normalizedBarcode],
    );
    if (conflict.rows[0]) { await client.query("rollback"); return { kind: "identity_conflict" }; }
    const inserted = await client.query(
      `insert into parts_catalog(company_id,normalized_part_number,part_number,description,manufacturer,category,barcode,uom_code,tracking_mode,source_provider,updated_at)
       select $1,$2,$3,$4,$5,$6,$7,$8,$9,'local',now()
       where exists(select 1 from units_of_measure where code=$8 and active=true)
       returning *`,
      [companyId, normalizedPartNumber, partNumber, description, manufacturer, category, barcode, uomCode, trackingMode],
    );
    const row = inserted.rows[0];
    if (!row) { await client.query("rollback"); return { kind: "uom_invalid" }; }
    if (referenceNumbers.length) await client.query(
      `insert into part_reference_numbers(company_id,catalog_part_id,reference_number,normalized_reference_number)
       select $1,$2,input.reference,input.normalized from unnest($3::text[],$4::text[]) input(reference,normalized)`,
      [companyId, row.id, referenceNumbers, normalizedReferences],
    );
    await client.query("commit");
    return { kind: "created", part: {
      id: row.id, catalogPartId: row.id, partNumber: row.part_number, normalizedPartNumber: row.normalized_part_number,
      description: row.description, manufacturer: row.manufacturer, category: row.category, barcode: row.barcode,
      uomCode: row.uom_code, canonicalUomCode: row.uom_code, trackingMode: row.tracking_mode, version: Number(row.version || 1), providerManaged: false,
      referenceNumbers, editableFields: ["description", "partNumber", "manufacturer", "category", "barcode", "uomCode", "trackingMode", "referenceNumbers"],
    } };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error?.code === "23505") return { kind: "identity_conflict" };
    throw error;
  } finally { client.release(); }
}

export async function updateCompanyCatalogPart({ catalogPartId, companyIds, actorId, expectedVersion, description, partNumber, manufacturer, category, barcode, uomCode, trackingMode, referenceNumbers }) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const scoped = await client.query("select company_id from parts_catalog where id=$1 and company_id=any($2::uuid[]) limit 1", [catalogPartId, companyIds]);
    if (!scoped.rows[0]) { await client.query("rollback"); return { kind: "not_found" }; }
    await lockCompanyPartIdentity(client, scoped.rows[0].company_id);
    const selected = await client.query(
      `select catalog.*,
              exists (select 1 from odoo_product_mappings mapping where mapping.company_id = catalog.company_id and mapping.catalog_part_id = catalog.id) as provider_managed,
              coalesce((select mapping.display_name from odoo_product_mappings mapping
                where mapping.company_id = catalog.company_id and mapping.catalog_part_id = catalog.id
                order by mapping.active desc, mapping.updated_at desc, mapping.external_id limit 1), '') as odoo_name
       from parts_catalog catalog where catalog.id = $1 and catalog.company_id = any($2::uuid[]) limit 1 for update`,
      [catalogPartId, companyIds],
    );
    const current = selected.rows[0];
    if (!current) { await client.query("rollback"); return { kind: "not_found" }; }
    if (Number(current.version) !== Number(expectedVersion)) { await client.query("rollback"); return { kind: "stale" }; }
    if (current.provider_managed && (partNumber !== current.part_number || category !== current.category || barcode !== current.barcode)) {
      await client.query("rollback"); return { kind: "provider_managed" };
    }
    const nextTrackingMode = trackingMode ?? current.tracking_mode;
    if (current.tracking_mode !== nextTrackingMode) {
      const history = await client.query(
        `select
           exists(select 1 from inventory_stock_movements movement where movement.company_id=$1 and movement.catalog_part_id=$2) as has_activity,
           exists(select 1 from inventory_serialized_units unit join inventory_receipt_lines line on line.company_id=unit.company_id and line.id=unit.receipt_line_id where unit.company_id=$1 and line.catalog_part_id=$2) as has_serial_history`,
        [current.company_id, catalogPartId],
      );
      if (current.tracking_mode && history.rows[0]?.has_activity) { await client.query("rollback"); return { kind: "tracking_locked" }; }
      if (nextTrackingMode !== "serialized" && history.rows[0]?.has_serial_history) { await client.query("rollback"); return { kind: "tracking_history_conflict" }; }
    }
    const displayOnlyUom = current.uom_locked_at !== null;
    let canonicalUomCode = uomCode;
    let displayUomCode = null;
    if (displayOnlyUom) {
      const equivalent = await client.query(
        `select 1 from units_of_measure canonical
         join units_of_measure preferred on preferred.code = $2 and preferred.active
         where canonical.code = $1 and canonical.active
           and (preferred.code = canonical.code or (
             canonical.reference_code is not null
             and canonical.conversion_factor is not null
             and preferred.reference_code = canonical.reference_code
             and preferred.conversion_factor = canonical.conversion_factor
             and preferred.decimal_scale = canonical.decimal_scale
           )) limit 1`,
        [current.uom_code, uomCode],
      );
      if (!equivalent.rows[0]) { await client.query("rollback"); return { kind: "uom_incompatible" }; }
      canonicalUomCode = current.uom_code;
      displayUomCode = uomCode === current.uom_code ? null : uomCode;
    }
    const normalizedPartNumber = normalizePartNumber(partNumber);
    const normalizedReferences = referenceNumbers.map(normalizePartNumber);
    const identities = [normalizedPartNumber, ...normalizedReferences];
    const normalizedBarcode = normalizePartNumber(barcode);
    if (new Set(identities).size !== identities.length) { await client.query("rollback"); return { kind: "identity_conflict" }; }
    const conflict = await client.query(
      `select 1 from parts_catalog c where c.company_id = $1 and c.id <> $2 and c.normalized_part_number = any($3::text[])
       union all select 1 from part_reference_numbers r where r.company_id = $1 and r.catalog_part_id <> $2 and r.normalized_reference_number = any($3::text[])
       union all select 1 from parts_catalog c where c.company_id = $1 and c.id <> $2 and upper(regexp_replace(coalesce(c.barcode, ''), '[^A-Za-z0-9]', '', 'g')) = any($3::text[])
       union all select 1 from odoo_product_mappings m where m.company_id = $1 and m.catalog_part_id <> $2 and (upper(regexp_replace(coalesce(m.default_code, ''), '[^A-Za-z0-9]', '', 'g')) = any($3::text[]) or upper(regexp_replace(coalesce(m.barcode, ''), '[^A-Za-z0-9]', '', 'g')) = any($3::text[]))
       union all select 1 from parts_catalog c where c.company_id = $1 and c.id <> $2 and lower(c.barcode) = lower($4) and $4 <> ''
       union all select 1 from odoo_product_mappings m where m.company_id = $1 and m.catalog_part_id <> $2 and lower(m.barcode) = lower($4) and $4 <> ''
       union all select 1 from parts_catalog c where c.company_id = $1 and c.id <> $2 and c.normalized_part_number = $5 and $5 <> ''
       union all select 1 from part_reference_numbers r where r.company_id = $1 and r.catalog_part_id <> $2 and r.normalized_reference_number = $5 and $5 <> '' limit 1`,
      [current.company_id, catalogPartId, identities, barcode, normalizedBarcode],
    );
    if (conflict.rows[0]) { await client.query("rollback"); return { kind: "identity_conflict" }; }
    const oldRefs = await client.query("select reference_number from part_reference_numbers where company_id=$1 and catalog_part_id=$2 order by lower(reference_number), id", [current.company_id, catalogPartId]);
    const before = state(current, oldRefs.rows.map((row) => row.reference_number));
    const updated = await client.query(
      `update parts_catalog set normalized_part_number=$3, part_number=$4, description=$5, manufacturer=$6, category=$7, barcode=$8, uom_code=$9, inventory_display_uom_code=$10, tracking_mode=$11, version=version+1, updated_at=now()
       where company_id=$1 and id=$2 returning *`,
      [current.company_id, catalogPartId, normalizedPartNumber, partNumber, description, manufacturer, category, barcode, canonicalUomCode, displayUomCode, nextTrackingMode],
    );
    await client.query("delete from part_reference_numbers where company_id=$1 and catalog_part_id=$2", [current.company_id, catalogPartId]);
    if (referenceNumbers.length) await client.query(
      `insert into part_reference_numbers(company_id,catalog_part_id,reference_number,normalized_reference_number)
       select $1,$2,input.reference,input.normalized from unnest($3::text[],$4::text[]) input(reference,normalized)`,
      [current.company_id, catalogPartId, referenceNumbers, normalizedReferences],
    );
    if (current.provider_managed) {
      await client.query(
        `update inventory_items set description=$3, manufacturer=$4, updated_at=now()
         where company_id=$1 and catalog_part_id=$2`,
        [current.company_id, catalogPartId, description, manufacturer],
      );
    } else {
      await client.query(
        `update inventory_items set normalized_part_number=$3, part_number=$4, description=$5, manufacturer=$6, updated_at=now()
         where company_id=$1 and catalog_part_id=$2`,
        [current.company_id, catalogPartId, normalizedPartNumber, partNumber, description, manufacturer],
      );
    }
    const row = updated.rows[0];
    const after = state(row, referenceNumbers);
    await client.query(
      `insert into part_catalog_edit_events(company_id,catalog_part_id,actor_id,version_before,version_after,before_state,after_state)
       values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
      [current.company_id, catalogPartId, actorId, current.version, row.version, JSON.stringify(before), JSON.stringify(after)],
    );
    await client.query("commit");
    return { kind: "updated", part: { catalogPartId: row.id, partNumber: row.part_number, description: row.description, odooName: current.odoo_name || "", manufacturer: row.manufacturer, category: row.category, barcode: row.barcode, uomCode: preferredUom(row), canonicalUomCode: row.uom_code, trackingMode: row.tracking_mode, uomLocked: row.uom_locked_at !== null, version: Number(row.version), providerManaged: current.provider_managed === true, referenceNumbers, editableFields: editableFields(current.provider_managed, row.uom_locked_at !== null) } };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error?.constraint === "parts_catalog_uom_locked" || error?.constraint === "catalog_uom_activity_uom_mismatch") return { kind: "uom_locked" };
    if (error?.constraint === "inventory_display_uom_not_equivalent") return { kind: "uom_incompatible" };
    if (error?.code === "23505") return { kind: "identity_conflict" };
    throw error;
  } finally { client.release(); }
}
