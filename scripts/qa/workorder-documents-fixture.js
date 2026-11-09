import { createHash, randomUUID } from "node:crypto";
import { permissionsForRole } from "../../src/server/auth/permissions.js";
import { createInventoryTaxProfile } from "../../src/server/modules/inventory/inventory-tax-profiles.service.js";
import { publishCustomerDocumentProfile } from "../../src/server/modules/customer-documents/customer-documents.service.js";
import { buildCustomerDocumentProjection } from "../../src/server/modules/customer-documents/customer-document-projection.js";
import { reviseWorkorderLaborRate, selectWorkorderLaborPrice } from "../../src/server/modules/workorders/workorder-labor-pricing.service.js";
import { readLockedWorkorderFinancialSource } from "../../src/server/db/repositories/customer-document-workorder-source.repo.js";
import { issueCustomerDocumentRevision } from "../../src/server/db/repositories/customer-documents.repo.js";

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requireDisposableDatabase() {
  const configured = process.env.DATABASE_URL;
  if (!configured) throw new Error("Document fixture requires DATABASE_URL.");
  const url = new URL(configured);
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(url.hostname)
    || !/^postgres(?:ql)?:$/.test(url.protocol)
    || !/^\/inspection_maintenance_test_[a-f0-9]{32}$/.test(url.pathname)
    || process.env.RUN_INSPECTION_MAINTENANCE_INTEGRATION !== "1") {
    throw new Error("Document fixture requires the runner's disposable loopback PostgreSQL database.");
  }
}

export async function seedWorkorderDocumentsFixture(pool, fixture) {
  requireDisposableDatabase();
  const { companyId, locationId, officeId, otherOfficeId, assetId, mechanicId } = fixture || {};
  let { workorderId } = fixture || {};
  if (!pool || ![companyId, locationId, officeId, otherOfficeId].every(Boolean)) {
    throw new Error("Document fixture requires its pool, company, location, Office actor, and Admin actor.");
  }
  if (!workorderId) {
    if (!assetId || !mechanicId) throw new Error("Document fixture needs an asset and mechanic to create its Workorder.");
    workorderId = randomUUID();
    await pool.query(
      `insert into operational_workorders
        (id,company_id,serial,asset_id,location_id,created_by_user_id,status,concern,form_data)
       values($1,$2,$3,$4,$5,$6,'accepted','QA document chat',$7::jsonb)`,
      [workorderId, companyId, `WO-DOCUMENTS-QA-${randomUUID().slice(0, 8).toUpperCase()}`,
        assetId, locationId, officeId, JSON.stringify({ customerCompanyName: "QA Customer" })],
    );
    await pool.query(
      `insert into workorder_mechanic_assignments
        (workorder_id,mechanic_user_id,assignment_role,assigned_by_user_id)
       values($1,$2,'primary',$3)`,
      [workorderId, mechanicId, officeId],
    );
  }
  const workorder = (await pool.query(
    "select id,progress_version from operational_workorders where id=$1 and company_id=$2 and location_id=$3",
    [workorderId, companyId, locationId],
  )).rows[0];
  if (!workorder) throw new Error("Document fixture Workorder is outside the requested company and location.");

  const adminContext = {
    actor: { id: otherOfficeId, role: "admin" },
    companyIds: new Set([companyId]),
    companyRoles: new Map([[companyId, "admin"]]),
    locationIds: new Set([locationId]),
    permissions: permissionsForRole("admin"),
  };
  const productId = randomUUID();
  await pool.query(
    "insert into local_labor_products(id,company_id,name,normalized_name,code,normalized_code,created_by_user_id) values($1,$2,'QA document labor',$3,$4,$3,$5)",
    [productId, companyId, `document-labor-${productId}`, `DOC-${productId}`, officeId],
  );
  await pool.query(
    "update operational_workorders set form_data=coalesce(form_data,'{}'::jsonb) || $4::jsonb where id=$1 and company_id=$2 and location_id=$3",
    [workorderId, companyId, locationId, JSON.stringify({ laborHours: "1", laborProduct: { productId, name: "QA document labor", uomCode: "hr" } })],
  );
  const officeContext = {
    actor: { id: officeId, role: "office" }, companyIds: new Set([companyId]),
    companyRoles: new Map([[companyId, "office"]]), locationIds: new Set([locationId]),
    permissions: permissionsForRole("office"),
  };
  await reviseWorkorderLaborRate(workorderId, {
    productId, locationId, priceKind: "selling_price", expectedVersion: 0, amount: "100", currency: "USD",
    reason: "Disposable document fixture selling rate", idempotencyKey: randomUUID(),
  }, officeContext, { companyId, locationId, workorder: { status: "accepted" } });
  const selected = await selectWorkorderLaborPrice(workorderId, {
    selection: "selling_price", reason: "Disposable document fixture selected selling rate", idempotencyKey: randomUUID(),
  }, officeContext);
  if (selected.kind !== "saved" || Number(selected.laborPrice.totalPrice) !== 100) throw new Error("Document fixture labor selection was not saved at $100.");
  const client = await pool.connect();
  let source;
  try {
    await client.query("begin");
    source = await readLockedWorkorderFinancialSource({ companyId, locationId, workorderId }, client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }

  const tax = await createInventoryTaxProfile({
    companyId,
    name: "QA Workorder tax",
    currency: "USD",
    jurisdiction: "QA fixture",
    components: [{ name: "QA sales tax", rate: "0", compound: false }],
    reason: "Disposable document fixture",
    idempotencyKey: `qa-doc-tax-${randomUUID()}`,
  }, adminContext);
  const profile = await publishCustomerDocumentProfile(adminContext, {
    companyId,
    locationId,
    expectedVersion: 0,
    shopIdentity: { legalName: "Maintenance QA Shop" },
    documentTerms: { estimate: "Estimate for QA review.", invoice: "", warranty: "", footer: "" },
    authorizationText: "I authorize the work shown.",
    discountPolicy: { maxOfficePercentage: "0", reasonRequired: true },
    lineTaxPolicy: {
      labor: "exempt", part: "exempt", shop_supply: "exempt", fee: "exempt",
      core_charge: "exempt", credit: "exempt",
    },
    documentNumbering: { estimate: { prefix: "EST-QA-", digits: 6 }, invoice: { prefix: "INV-QA-", digits: 6 } },
    estimateValidityDays: 30,
    defaultCurrency: "USD",
    taxProfileVersionId: tax.profile.current.id,
    idempotencyKey: `qa-doc-profile-${randomUUID()}`,
  });

  const draftId = randomUUID();
  await pool.query(
    `insert into workorder_drafts
      (id,company_id,location_id,created_by_user_id,owner_user_id,last_edited_by_user_id,payload)
     values($1,$2,$3,$4,$4,$4,$5::jsonb)`,
    [draftId, companyId, locationId, officeId, JSON.stringify({
      formData: { unitNo: "QA-MAINT-1", mechanicConcern: "QA document chat", customerCompanyName: "QA Customer" },
    })],
  );
  const pricingFingerprint = source.pricingFingerprint;
  const { projection, contentHash } = buildCustomerDocumentProjection({
    document: { type: "estimate", state: "draft_projection" },
    shop: { legalName: "Maintenance QA Shop" },
    customer: { name: "QA Customer", company: "QA Customer" },
    unit: { id: fixture.assetId, label: "QA-MAINT-1" },
    concern: "QA document chat",
    repairDescription: "Diagnostic labor",
    terms: "Estimate for QA review.",
    authorizationText: "I authorize the work shown.",
    warrantyText: "",
    footer: "",
    profileVersionId: profile.profileVersion.id,
    templateVersion: "customer-document-v1",
    taxProfileVersionId: tax.profile.current.id,
    sourceEvidence: {
      kind: "workorder", id: workorderId, version: workorder.progress_version, pricingFingerprint,
    },
    discountEvidence: { documentDiscount: null },
    financial: {
      currency: "USD",
      basis: "estimated",
      lines: [{
        id: "qa-labor", type: "labor", description: "Diagnostic labor", quantity: "1", unit: "hr",
        unitPrice: "100", priceBasis: "selling_price", taxCategory: "labor", taxTreatment: "exempt",
        taxComponents: [], discountEligible: true, source: { kind: "labor_snapshot", id: source.labor.id },
      }],
    },
  });
  const issued = await issueCustomerDocumentRevision({
    companyId,
    locationId,
    draftId,
    workorderId,
    documentType: "estimate",
    profileVersionId: profile.profileVersion.id,
    snapshot: projection,
    contentHash,
    financialFingerprint: projection.financialFingerprint,
    recipientSnapshot: { name: "QA Customer", company: "QA Customer", channel: "link" },
    currency: projection.totals.currency,
    subtotal: projection.totals.subtotal,
    discountTotal: projection.totals.discountTotal,
    taxTotal: projection.totals.tax,
    totalAmount: projection.totals.total,
    actorId: officeId,
    idempotencyKey: `qa-doc-issue-${randomUUID()}`,
    requestHash: hash({ draftId, workorderId, financialFingerprint: projection.financialFingerprint }),
  }, { pool });
  return {
    workorderId,
    draftId,
    documentId: issued.revision.documentId,
    revisionId: issued.revision.id,
    profileVersionId: profile.profileVersion.id,
  };
}
