import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { permissionsForRole } from "../../src/server/auth/permissions.js";
import { reviseWorkorderLaborRate, selectWorkorderLaborPrice } from "../../src/server/modules/workorders/workorder-labor-pricing.service.js";

export async function seedNormalCustomerFlowWorkorder(pool, fixture) {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/inspection_maintenance_test_[a-f0-9]{32}$/);
  assert.equal(process.env.RUN_INSPECTION_MAINTENANCE_INTEGRATION, "1");
  const { companyId, locationId, officeId, mechanicId } = fixture;
  const workorderId = randomUUID();
  const productId = randomUUID();
  const assetId = randomUUID();
  const unitNo = `FLOW-${workorderId.slice(0, 8)}`;
  await pool.query("insert into assets(id,company_id,location_id,provider,unit_type,unit_no,name) values($1,$2,$3,'manual','Truck',$4,$4)", [assetId, companyId, locationId, unitNo]);
  await pool.query("insert into local_labor_products(id,company_id,name,normalized_name,code,normalized_code,created_by_user_id) values($1,$2,'Customer flow labor',$3,'FLOW-LABOR',$3,$4)", [productId, companyId, `flow-${productId}`, officeId]);
  const form = { customerCompanyName: "Local Customer Flow", unitNo, laborHours: "3", laborProduct: { productId, name: "Customer flow labor", uomCode: "hr" }, parts: [] };
  await pool.query("insert into operational_workorders(id,company_id,location_id,asset_id,serial,status,concern,form_data,created_by_user_id) values($1,$2,$3,$4,$5,'accepted','Normal customer flow',$6::jsonb,$7)", [workorderId, companyId, locationId, assetId, `WO-CUSTOMER-FLOW-${workorderId.slice(0, 8)}`, JSON.stringify(form), officeId]);
  await pool.query("insert into workorder_mechanic_assignments(workorder_id,mechanic_user_id,assignment_role,assigned_by_user_id) values($1,$2,'primary',$3)", [workorderId, mechanicId, officeId]);
  await pool.query("insert into chat_messages(workorder_id,sender_role,message_type,body) values($1,'office','normal','Private shop note for normal-flow regression')", [workorderId]);
  const context = { actor: { id: officeId, role: "office" }, companyIds: new Set([companyId]), companyRoles: new Map([[companyId, "office"]]), locationIds: new Set([locationId]), permissions: permissionsForRole("office") };
  await reviseWorkorderLaborRate(workorderId, { productId, locationId, priceKind: "selling_price", expectedVersion: 0, amount: "100", currency: "USD", reason: "Disposable normal flow selling rate", idempotencyKey: randomUUID() }, context, { companyId, locationId, workorder: { status: "accepted" } });
  const selected = await selectWorkorderLaborPrice(workorderId, { selection: "selling_price", reason: "Normal flow selected selling rate", idempotencyKey: randomUUID() }, context);
  assert.equal(selected.kind, "saved");
  assert.equal(Number(selected.laborPrice.totalPrice), 300);
  return { workorderId, productId, companyId, locationId };
}
