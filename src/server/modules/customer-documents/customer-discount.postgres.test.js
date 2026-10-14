import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { closePool, getPool } from "../../db/pool.js";
import { readCreatePricing } from "../../db/repositories/workorder-create-pricing.repo.js";
import { permissionsForRole } from "../../auth/permissions.js";
import { issueInformationalDraftEstimate, previewCustomerDocument } from "./customer-documents.service.js";
import { handleCustomerDocumentsApi } from "../../routes/customer-documents.routes.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
after(async () => { if (enabled) await closePool(); });

test("saved discount intent produces identical preview and direct-create financials from PostgreSQL prices", { skip: !enabled }, async () => {
  const client = await getPool().connect();
  const companyId = randomUUID(), locationId = randomUUID(), actorId = randomUUID();
  const productId = randomUUID(), draftId = randomUUID(), profileId = randomUUID();
  const context = { actor: { id: actorId, role: "admin" }, companyIds: new Set([companyId]),
    locationIds: new Set([locationId]), permissions: permissionsForRole("admin") };
  const profile = { id: profileId, informationalOnly: false, defaultCurrency: "USD",
    shopIdentity: { legalName: "Discount fixture" }, documentTerms: { estimate: "Fixture terms" },
    authorizationText: "Information only.", taxProfileVersionId: null,
    discountPolicy: { maxOfficePercentage: "10" }, lineTaxPolicy: { labor: "exclusive" },
    taxComponents: [{ name: "Fixture tax", rate: "7.75", compound: false }] };
  const intent = { lineDiscounts: [], documentDiscount: { kind: "percentage", value: "5", reason: "Fixture discount" }, overrideReasons: [] };
  const payload = { companyId, locationId, concern: "Inspect", pricing: { parts: [], labor: { selection: "selling_price" } },
    formData: { customerCompanyName: "Fixture customer", parts: [], laborHours: "3",
      laborProduct: { productId, name: "Labor", code: "FIXTURE", uomCode: "hr" }, customerDocumentAdjustments: intent } };
  async function getDraft() {
    const { rows: [row] } = await client.query("select * from workorder_drafts where id=$1", [draftId]);
    return { id: row.id, companyId: row.company_id, locationId: row.location_id,
      status: row.status, version: row.version, payload: row.payload };
  }
  const dependencies = { getDraft, getProfile: async () => profile,
    readCreatePricing: (input) => readCreatePricing(input, client),
    ensureInformationalProfile: async () => profile, readCurrentEstimateForUpdate: async () => null,
    issueRevision: async (command) => ({ revision: { id: randomUUID() }, captured: command }) };
  async function routePreview(body, requestContext = context) {
    let response;
    await handleCustomerDocumentsApi({ method: "POST", headers: {} }, {},
      new URL("http://localhost/api/customer-documents/previews"), {
        requestContext, readBody: async () => body,
        sendJson: (_res, status, result) => { assert.equal(status, 200); response = result; },
      }, { preview: (ctx, input) => previewCustomerDocument(ctx, input, dependencies) });
    return response;
  }
  try {
    await client.query("begin");
    await client.query("insert into user_profiles(id,display_name) values($1,'Discount fixture')", [actorId]);
    await client.query("insert into companies(id,slug,name) values($1,$2,'Discount fixture')", [companyId, `discount-${companyId}`]);
    await client.query("insert into locations(id,company_id,name) values($1,$2,'Discount shop')", [locationId, companyId]);
    await client.query(`insert into local_labor_products(id,company_id,name,normalized_name,code,normalized_code,uom_code,created_by_user_id)
      values($1,$2,'Labor','labor','FIXTURE','fixture','hr',$3)`, [productId, companyId, actorId]);
    await client.query(`insert into labor_rate_versions
      (company_id,labor_product_id,price_kind,version,amount,currency,reason,created_by,idempotency_key,request_hash)
      values($1,$2,'selling_price',1,100,'USD','Fixture price',$3,$4,$5)`, [companyId, productId, actorId, `rate-${productId}`, "a".repeat(64)]);
    await client.query(`insert into workorder_drafts
      (id,company_id,location_id,created_by_user_id,owner_user_id,last_edited_by_user_id,payload)
      values($1,$2,$3,$4,$4,$4,$5::jsonb)`, [draftId, companyId, locationId, actorId, JSON.stringify(payload)]);
    const draft = await getDraft();
    assert.deepEqual(draft.payload.formData.customerDocumentAdjustments, intent, "intent survives real JSONB round-trip");
    const preview = await routePreview({ companyId, locationId,
      source: { kind: "draft", id: draftId, expectedVersion: draft.version }, adjustments: intent });
    const issued = await issueInformationalDraftEstimate(context, draft, payload, client, dependencies);
    assert.equal(preview.projection.totals.subtotal, "300.00");
    assert.equal(preview.projection.totals.discountTotal, "15.00");
    assert.equal(preview.projection.totals.tax, "22.09");
    assert.equal(preview.projection.totals.total, "307.09");
    assert.deepEqual(issued.captured.snapshot.totals, preview.projection.totals);
    assert.equal(issued.captured.financialFingerprint, preview.projection.financialFingerprint);
    await assert.rejects(routePreview({ companyId, locationId,
      source: { kind: "draft", id: draftId, expectedVersion: draft.version },
      adjustments: { ...intent, documentDiscount: { ...intent.documentDiscount, reason: "x" } } }),
    (error) => error.name === "ZodError");
    const office = { ...context, actor: { id: actorId, role: "office" }, permissions: permissionsForRole("office") };
    await assert.rejects(routePreview({ companyId, locationId,
      source: { kind: "draft", id: draftId, expectedVersion: draft.version },
      adjustments: { ...intent, documentDiscount: { kind: "percentage", value: "20", reason: "Over authority" } } }, office),
    (error) => error.code === "CUSTOMER_DOCUMENT_DISCOUNT_POLICY_DENIED");
    await assert.rejects(routePreview({ companyId, locationId,
      source: { kind: "draft", id: draftId, expectedVersion: draft.version }, adjustments: intent },
    { ...context, companyIds: new Set() }));
    await assert.rejects(routePreview({ companyId, locationId,
      source: { kind: "draft", id: draftId, expectedVersion: draft.version }, adjustments: intent },
    { ...context, permissions: new Set() }), (error) => error.code === "PERMISSION_DENIED");
    await assert.rejects(previewCustomerDocument(context, { companyId, locationId,
      source: { kind: "draft", id: draftId, expectedVersion: draft.version + 1 }, adjustments: intent }, dependencies),
    (error) => error.code === "CUSTOMER_DOCUMENT_SOURCE_CHANGED");
  } finally {
    await client.query("rollback");
    client.release();
  }
});
