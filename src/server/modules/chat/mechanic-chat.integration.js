import assert from "node:assert/strict";
import { closePool, query } from "../../db/pool.js";
import { addSystemChatMessageOnce, getChatAttachmentById, listChatMessages } from "../../db/repositories/chat.repo.js";
import { acceptOperationalWorkorder, createOperationalWorkorder } from "../../db/repositories/operational-workorders.repo.js";
import { listWorkorderPartRequests } from "../../db/repositories/part-requests.repo.js";
import { loadWorkorderDetail } from "../workorders/workorder-detail.service.js";
import { processMechanicChatMessage } from "./mechanic-chat.service.js";
import { readStoredChatImage } from "./chat-media.service.js";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const suffix = Date.now().toString(36);
const companyKey = `chat-test-${suffix}`;
let companyId;
let locationId;
let workorderId;
let assetId;

try {
  const company = await query(
    `insert into companies (slug, name) values ($1, $2) returning id`,
    [companyKey, `Chat Test ${suffix}`],
  );
  companyId = company.rows[0].id;
  const location = await query(
    `insert into locations (company_id, name, type)
     values ($1, $2, 'yard') returning id`,
    [companyId, `Chat Test Yard ${suffix}`],
  );
  locationId = location.rows[0].id;

  const users = await query(
    `select profile.id, role.role
       from user_profiles profile
       join v_user_primary_role role on role.user_id = profile.id
      where role.role in ('mechanic', 'office') and profile.active
      order by role.role`,
  );
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

  const asset = await query(
    `insert into assets (company_id, provider, unit_type, name, unit_no, vin, make, model, year)
     values ($1, 'manual', 'Truck', $2, $2, $3, 'Freightliner', 'Cascadia', 2022)
     returning id`,
    [companyId, `CHAT-${suffix}`, `1FUJGLDR0NL${String(Date.now()).slice(-6)}`.slice(0, 17)]
  );
  assetId = asset.rows[0].id;
  await query(
    `insert into workorder_serial_counters (company_id, prefix, next_number, digits)
     values ($1, $2, 1, 4)`,
    [companyId, `CHAT-${suffix}-`]
  );
  const workorder = await createOperationalWorkorder({
    companyId,
    assetId,
    locationId,
    createdByUserId: office.id,
    concern: "Mechanic chat attachment integration test",
    formData: { parts: [] },
  });
  workorderId = workorder.id;
  await acceptOperationalWorkorder(workorderId, mechanic.id);

  let pricingCalls = 0;
  const response = await processMechanicChatMessage(workorderId, {
    senderUserId: mechanic.id,
    senderRole: "mechanic",
    messageType: "normal",
    body: "Need this lube filter",
    attachment: { dataUrl: PNG_DATA_URL, fileName: "../../filter label.png" },
  }, {
    identifyPart: async ({ workorderContext }) => {
      assert.equal(workorderContext.make, "Freightliner");
      return {
        part: {
          status: "matched",
          normalizedPartNumber: "LF9009",
          manufacturer: "Fleetguard",
          description: "Lube filter",
          category: "engine_oil_filter",
          suggestedQuantity: 1,
          repairOrder: "Replace lube filter and inspect for leaks.",
          fitmentStatus: "possible",
          confidence: 84,
          evidenceSummary: "Office fitment confirmation required.",
          cautions: [],
        },
        sources: [{ url: "https://example.com/lf9009" }],
      };
    },
    findPrices: async () => { pricingCalls += 1; },
  });

  assert.equal(response.message.messageType, "part_request");
  assert.ok(response.message.attachment?.id);
  assert.equal(response.message.attachment.fileName, "filter-label.png");
  assert.equal(response.partRequest.sourceChatMessageId, response.message.id);
  assert.equal(response.partRequest.sourceAttachmentId, response.message.attachment.id);
  assert.equal(response.partRequest.repairOrder, "Replace lube filter and inspect for leaks.");
  assert.equal(response.intelligence.pricingSearched, false);
  assert.equal(pricingCalls, 0);

  const attachment = await getChatAttachmentById(response.message.attachment.id);
  const storedBytes = await readStoredChatImage(attachment);
  assert.equal(storedBytes.length, attachment.byteSize);
  assert.equal(attachment.mimeType, "image/png");
  assert.ok(Buffer.isBuffer(attachment.content));

  const requests = await listWorkorderPartRequests(workorderId);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].rawContext.source, "mechanic_chat");
  assert.equal(requests[0].rawContext.attachment.id, response.message.attachment.id);

  await addSystemChatMessageOnce({ workorderId, body: "Only once", dedupeKey: "integration-dedupe" });
  await addSystemChatMessageOnce({ workorderId, body: "Only once", dedupeKey: "integration-dedupe" });
  const messages = await listChatMessages(workorderId);
  assert.equal(messages.filter((message) => message.body === "Only once").length, 1);
  assert.ok(messages.find((message) => message.id === response.message.id)?.attachment);

  const detail = await loadWorkorderDetail(workorderId);
  assert.equal(detail.partRequests.length, 1);
  assert.ok(detail.messages.some((message) => message.attachment?.id === response.message.attachment.id));

  console.log(JSON.stringify({
    passed: true,
    attachmentPersisted: true,
    structuredPartRequestCreated: true,
    sourceContextPersisted: true,
    duplicateSystemMessagePrevented: true,
    pricingSearched: false,
  }));
} finally {
  if (workorderId) await query("delete from operational_workorders where id = $1", [workorderId]);
  if (assetId) await query("delete from assets where id = $1", [assetId]);
  if (companyId) await query("delete from workorder_serial_counters where company_id = $1", [companyId]);
  if (locationId) await query("delete from locations where id = $1", [locationId]);
  if (companyId) await query("delete from companies where id = $1", [companyId]);
  await closePool();
}
