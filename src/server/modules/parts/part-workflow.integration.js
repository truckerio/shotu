import assert from "node:assert/strict";
import { closePool, query } from "../../db/pool.js";
import {
  createPartRequest,
  createApprovedOfficePart,
  decidePartRequest,
  listWorkorderPartRequests,
  updatePartAllocation,
  updatePartUsage,
} from "../../db/repositories/part-requests.repo.js";
import {
  acceptOperationalWorkorder,
  createOperationalWorkorder,
  getOperationalWorkorderById,
  getWorkorderTimeline,
  queryOperationalWorkorders,
} from "../../db/repositories/operational-workorders.repo.js";
import { normalizePartNumber } from "./part.constants.js";

const suffix = Date.now().toString(36);
const companyKey = `parts-test-${suffix}`;
let companyId;
let locationId;
let workorderId;

try {
  const company = await query(
    `insert into companies (slug, name) values ($1, $2) returning id`,
    [companyKey, `Parts Test ${suffix}`],
  );
  companyId = company.rows[0].id;
  const location = await query(
    `insert into locations (company_id, name, type)
     values ($1, $2, 'yard') returning id`,
    [companyId, `Parts Test Yard ${suffix}`],
  );
  locationId = location.rows[0].id;

  const [users, asset] = await Promise.all([
    query(
      `select profile.id, role.role
         from user_profiles profile
         join v_user_primary_role role on role.user_id = profile.id
        where role.role in ('mechanic', 'office') and profile.active
        order by role.role`,
    ),
    query("select id from assets where unit_type = 'Truck' and company_id = $1 order by updated_at desc limit 1", [companyId]),
  ]);
  const mechanic = users.rows.find((user) => user.role === "mechanic");
  const office = users.rows.find((user) => user.role === "office");
  assert.ok(mechanic && office, "Test requires active mechanic and office users.");
  await query(
    `insert into user_company_memberships (user_id, company_id, role)
     values ($1, $3, 'mechanic'), ($2, $3, 'office')`,
    [mechanic.id, office.id, companyId],
  );
  await query(
    `insert into user_location_memberships (user_id, location_id, company_id)
     values ($1, $3, $4), ($2, $3, $4)`,
    [mechanic.id, office.id, locationId, companyId],
  );

  await query(
    `insert into workorder_serial_counters (company_id, prefix, next_number, digits)
     values ($1, $2, 1, 4)`,
    [companyId, `PT-${suffix}-`]
  );
  const workorder = await createOperationalWorkorder({
    companyId,
    assetId: asset.rows[0]?.id || null,
    locationId,
    createdByUserId: office.id,
    concern: "Integration test oil service",
    formData: { parts: [] },
  });
  workorderId = workorder.id;
  await acceptOperationalWorkorder(workorderId, mechanic.id);

  const request = await createPartRequest(workorderId, {
    mechanicUserId: mechanic.id,
    query: "Need LF14000NN oil filters",
    partNumber: "LF14000NN",
    manufacturer: "Fleetguard",
    description: "Engine oil filter",
    category: "engine_oil_filter",
    quantity: 2,
    repairOrder: "Replace engine oil filter and inspect for leaks.",
    fitmentStatus: "possible",
    fitmentNotes: "Office verification required.",
  });
  assert.equal(request.approvalStatus, "submitted");
  assert.equal((await getOperationalWorkorderById(workorderId)).status, "accepted");
  const pendingAttention = await queryOperationalWorkorders({ companyIds: [companyId], attentionReason: "parts" });
  assert.equal(pendingAttention.items.some((item) => item.id === workorderId), true);
  assert.deepEqual((await getOperationalWorkorderById(workorderId)).formData.parts, []);

  const inventory = await query(
    `insert into inventory_items (
       company_id, location_id, normalized_part_number, part_number, manufacturer,
       description, quantity_on_hand, quantity_reserved, bin_location
     ) values ($1, $2, $3, $4, $5, $6, 10, 0, 'B-12') returning id`,
    [companyId, locationId, normalizePartNumber("LF14000NN"), "LF14000NN", "Fleetguard", "Engine oil filter"]
  );
  const approved = await decidePartRequest(workorderId, request.id, {
    officeUserId: office.id,
    decision: "approved",
    partNumber: "LF14000NN",
    manufacturer: "Fleetguard",
    description: "Engine oil filter",
    category: "engine_oil_filter",
    quantity: 2,
    repairOrder: "Replace engine oil filter and inspect for leaks.",
    fitmentStatus: "confirmed",
    fitmentNotes: "Verified by office.",
    reason: "",
    allocations: [{
      sourceType: "inventory",
      status: "reserved",
      quantity: 2,
      locationId,
      inventoryItemId: inventory.rows[0].id,
      vendor: "",
      sourceReference: "",
      unitPrice: null,
      quoteUrl: "",
    }],
  }, office.id);
  assert.equal(approved.approvalStatus, "approved");
  assert.equal(approved.allocations[0].status, "reserved");
  assert.equal(approved.inventory[0].quantityAvailable, 8);
  const learnedCatalogPart = await query(
    `select aliases from parts_catalog
     where company_id = $1 and normalized_part_number = $2`,
    [companyId, normalizePartNumber("LF14000NN")],
  );
  assert.deepEqual(learnedCatalogPart.rows[0].aliases, ["Need LF14000NN oil filters"]);

  const afterApproval = await getOperationalWorkorderById(workorderId);
  assert.equal(afterApproval.status, "accepted");
  const resolvedAttention = await queryOperationalWorkorders({ companyIds: [companyId], attentionReason: "parts" });
  assert.equal(resolvedAttention.items.some((item) => item.id === workorderId), false);
  assert.deepEqual(afterApproval.formData.parts, []);
  const approvalMessage = await query(
    "select body from chat_messages where workorder_id = $1 and message_type = 'system' order by created_at desc limit 1",
    [workorderId]
  );
  assert.match(approvalMessage.rows[0].body, /Office approved 2 x LF14000NN/);
  assert.match(approvalMessage.rows[0].body, /inventory \(Reserved\)/);

  await updatePartAllocation(workorderId, request.id, approved.allocations[0].id, { status: "issued", note: "Issued to mechanic." }, office.id);
  const issuedInventory = await query("select quantity_on_hand, quantity_reserved from inventory_items where id = $1", [inventory.rows[0].id]);
  assert.equal(issuedInventory.rows[0].quantity_on_hand, 8);
  assert.equal(issuedInventory.rows[0].quantity_reserved, 0);
  const issuedMessage = await query(
    "select body from chat_messages where workorder_id = $1 and message_type = 'system' order by created_at desc limit 1",
    [workorderId]
  );
  assert.match(issuedMessage.rows[0].body, /is now Issued/);

  const installed = await updatePartUsage(workorderId, request.id, {
    mechanicUserId: mechanic.id,
    usageStatus: "installed",
    note: "Installed and leak checked.",
  });
  assert.equal(installed.usageStatus, "installed");
  const installedMessage = await query(
    "select body from chat_messages where workorder_id = $1 and message_type = 'system' order by created_at desc limit 1",
    [workorderId]
  );
  assert.match(installedMessage.rows[0].body, /Mechanic marked 2 x LF14000NN as Installed/);
  const officeAdded = await createApprovedOfficePart(workorderId, {
    officeUserId: office.id,
    query: "Customer supplied air filter",
    partNumber: "AF-TEST-1",
    manufacturer: "Test",
    description: "Cab air filter",
    category: "cab_filter",
    quantity: 1,
    repairOrder: "Replace cab air filter.",
    fitmentStatus: "confirmed",
    fitmentNotes: "Verified by office.",
    allocations: [{
      sourceType: "customer_supplied",
      status: "received",
      quantity: 1,
      vendor: "",
      sourceReference: "Customer",
      unitPrice: null,
      quoteUrl: "",
    }],
  }, office.id);
  assert.equal(officeAdded.approvalStatus, "approved");
  assert.equal(officeAdded.allocations[0].sourceType, "customer_supplied");
  assert.equal((await listWorkorderPartRequests(workorderId)).length, 2);
  const afterOfficeAdd = await getOperationalWorkorderById(workorderId);
  assert.equal(afterOfficeAdd.formData.parts.length, 1);
  assert.equal(afterOfficeAdd.formData.parts[0].partNo, "AF-TEST-1");
  assert.equal(afterOfficeAdd.formData.parts[0].requestId, undefined);
  assert.ok((await getWorkorderTimeline(workorderId)).filter((event) => event.type === "part").length >= 4);

  console.log(JSON.stringify({
    passed: true,
    workflow: ["submitted", "approved", "inventory_reserved", "issued", "installed", "office_added_customer_part"],
    printableProjection: true,
    auditTimeline: true,
  }));
} finally {
  if (workorderId) await query("delete from operational_workorders where id = $1", [workorderId]);
  if (companyId) {
    await query("delete from inventory_items where company_id = $1", [companyId]);
    await query("delete from parts_catalog where company_id = $1", [companyId]);
    await query("delete from workorder_serial_counters where company_id = $1", [companyId]);
  }
  if (locationId) await query("delete from locations where id = $1", [locationId]);
  if (companyId) await query("delete from companies where id = $1", [companyId]);
  await closePool();
}
