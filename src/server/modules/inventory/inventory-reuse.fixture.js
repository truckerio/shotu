// Isolated local/PostgreSQL QA fixture. Never invoked by application runtime.
import { randomUUID, createHash } from "node:crypto";
import { query, getPool } from "../../db/pool.js";
import { issueSerializedUnitToWorkorder, finalizeSerializedUnitUsage, consumePendingSerializedInstallationsForApproval } from "../../db/repositories/inventory-unit-workorder-usage.repo.js";
export const reuseDigest = (text) => createHash("sha256").update(text).digest("hex");
export async function createInventoryReuseFixture({installed = true, configured = true} = {}) {
  const suffix = randomUUID().replaceAll("-","");
  const f = Object.fromEntries(["companyId","locationId","assetId","secondAssetId","workorderId","removalWorkorderId","secondWorkorderId","catalogPartId","unitId","pendingUnitId","adminId","removerId","receiverId","releaseId","runId","receiptId","lineId"].map((key)=>[key,randomUUID()]));
  f.suffix = suffix;
  f.createRemovalWorkorder = async () => {
    await query(`insert into operational_workorders(id,company_id,serial,asset_id,location_id,created_by_user_id,concern,status)
      values($1,$2,$3,$4,$5,$6,'Custody removal QA','in_progress')`,[f.removalWorkorderId,f.companyId,`WO-CQ-removal-${suffix}`,f.assetId,f.locationId,f.adminId]);
    return f.removalWorkorderId;
  };
  f.cleanup = async () => {
    // Restrict every delete to this fresh random company, in FK order.
    for (const table of ["inventory_reuse_operations","inventory_reuse_audit_events","inventory_reuse_cases","inventory_reuse_capability_grants","inventory_reuse_catalog_policies","inventory_unit_events","inventory_stock_movements","workorder_serialized_part_usage_commands","workorder_serialized_part_usages","inventory_serialized_units","inventory_receipt_lines","inventory_receipts","inventory_items","parts_catalog"]) {
      await query(`delete from ${table} where company_id=$1`,[f.companyId]);
    }
    await query("delete from workorder_mechanic_assignments where workorder_id=any($1::uuid[])",[[f.workorderId,f.removalWorkorderId,f.secondWorkorderId]]);
    await query("delete from workorder_drafts where company_id=$1",[f.companyId]);
    await query("delete from operational_workorders where company_id=$1",[f.companyId]);
    await query("delete from workorder_serial_counters where company_id=$1",[f.companyId]);
    await query("delete from assets where company_id=$1",[f.companyId]);
    await query("delete from invoice_extraction_runs where company_id=$1",[f.companyId]);
    await query("delete from user_location_memberships where company_id=$1",[f.companyId]);
    await query("delete from user_company_memberships where company_id=$1",[f.companyId]);
    await query("delete from locations where company_id=$1",[f.companyId]);
    await query("delete from companies where id=$1",[f.companyId]);
    await query("delete from user_profiles where id=any($1::uuid[])",[[f.adminId,f.removerId,f.receiverId,f.releaseId]]);
  };
  try {
    await query("insert into companies(id,slug,name) values($1,$2,'Custody QA')",[f.companyId,`custody-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Custody QA shop')",[f.locationId,f.companyId]);
    for (const [id,name,role,capability] of [[f.adminId,"Administrator","admin",null],[f.removerId,"Remover","office","remove"],[f.receiverId,"Receiver","office","receive"],[f.releaseId,"Inspector","office","release"]]) {
      await query("insert into user_profiles(id,display_name) values($1,$2)",[id,`Custody ${name} ${suffix.slice(0,8)}`]);
      await query("insert into user_company_memberships(user_id,company_id,role,active) values($1,$2,$3,true)",[id,f.companyId,role]);
      await query("insert into user_location_memberships(user_id,company_id,location_id,active) values($1,$2,$3,true)",[id,f.companyId,f.locationId]);
      if (capability && configured) await query("insert into inventory_reuse_capability_grants(company_id,location_id,user_id,capability,granted_by_user_id) values($1,$2,$3,$4,$5)",[f.companyId,f.locationId,id,capability,f.adminId]);
    }
    for (const [id,name] of [[f.assetId,"A"],[f.secondAssetId,"B"]]) await query("insert into assets(id,company_id,location_id,provider,name,unit_no) values($1,$2,$3,'manual',$4,$5)",[id,f.companyId,f.locationId,`Custody Truck ${name}`,`CQ-${name}-${suffix.slice(0,8)}`]);
    for (const [id,asset,name] of [[f.workorderId,f.assetId,"original"],[f.secondWorkorderId,f.secondAssetId,"reuse"]]) await query(`insert into operational_workorders(id,company_id,serial,asset_id,location_id,created_by_user_id,concern,status)
      values($1,$2,$3,$4,$5,$6,'Custody lifecycle QA','in_progress')`,[id,f.companyId,`WO-CQ-${name}-${suffix}`,asset,f.locationId,f.adminId]);
    await query("insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code) values($1,$2,$3,$4,'Reusable QA alternator','ea')",[f.catalogPartId,f.companyId,`CQ${suffix}`,`CQ-${suffix}`]);
    await query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at)
      values($1,$2,$3,$4,$4,$5,'custody.pdf','application/pdf',1,$6,'reviewed','local-test','local-test','local-v1',$7::jsonb,now())`,[f.runId,f.companyId,f.locationId,f.adminId,reuseDigest(suffix),`extract-${suffix}`,JSON.stringify({documentType:{value:"invoice"},lines:[]})]);
    await query(`insert into inventory_receipts(id,company_id,location_id,invoice_run_id,created_by,idempotency_key,provider,provider_marker,provider_picking_name,status,confirmed_at)
      values($1,$2,$3,$4,$5,$6,'local',$7,'Custody original purchase','confirmed',now())`,[f.receiptId,f.companyId,f.locationId,f.runId,f.adminId,`receipt-${suffix}`,`LOCAL-${suffix}`]);
    await query(`insert into inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode)
      values($1,$2,$3,0,$4,$5,$6,'Reusable QA alternator',2,'ea','serial')`,[f.lineId,f.companyId,f.receiptId,f.catalogPartId,`local:${f.catalogPartId}`,`CQ-${suffix}`]);
    await query(`insert into inventory_serialized_units(id,company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status)
      values($1,$3,$4,$5,$6,1,$7,'in_stock'),($2,$3,$4,$5,$6,2,$8,'in_stock')`,[f.unitId,f.pendingUnitId,f.companyId,f.locationId,f.receiptId,f.lineId,`CQ-SERIAL-${suffix}-1`,`CQ-SERIAL-${suffix}-2`]);
    await query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id)
      values($1,$2,$3,$4,$5,'Reusable QA alternator',2,0,'ea','local',$6)`,[f.companyId,f.locationId,f.catalogPartId,`CQ${suffix}`,`CQ-${suffix}`,`local:${suffix}`]);
    if (configured) await query("insert into inventory_reuse_catalog_policies(company_id,location_id,catalog_part_id,reuse_allowed,evidence,updated_by_user_id) values($1,$2,$3,true,'QA approved reusable catalog item',$4)",[f.companyId,f.locationId,f.catalogPartId,f.adminId]);
    f.originalWorkorderId = f.workorderId;
    f.invoiceRunId = f.runId;
    if (!installed) return f;
    const scope = {companyId:f.companyId,locationId:f.locationId,workorderId:f.workorderId,actorId:f.removerId,actorRole:"office"};
    const issued = await issueSerializedUnitToWorkorder({...scope,unitId:f.unitId,idempotencyKey:`initial-${suffix}`,requestHash:reuseDigest(`initial-${suffix}`)});
    if (!issued.usage) throw new Error(`Fixture issue failed: ${issued.kind}`);
    f.usageId = issued.usage.id;
    await finalizeSerializedUnitUsage({...scope,usageId:f.usageId,disposition:"installed",idempotencyKey:`install-${suffix}`,requestHash:reuseDigest(`install-${suffix}`)});
    const client = await getPool().connect();
    try { await client.query("begin"); await consumePendingSerializedInstallationsForApproval(client,{workorderId:f.workorderId,companyId:f.companyId,officeUserId:f.adminId}); await client.query("update operational_workorders set status='closed' where id=$1",[f.workorderId]); await client.query("commit"); }
    catch(error) {await client.query("rollback");throw error;} finally {client.release();}
    await f.createRemovalWorkorder();
    return f;
  } catch(error) {
    try { await f.cleanup(); }
    catch(cleanupError) { throw new AggregateError([error,cleanupError],`Custody fixture failed and cleanup needs review for company ${f.companyId}`); }
    throw error;
  }
}
