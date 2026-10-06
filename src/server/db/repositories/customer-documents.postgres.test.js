import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { closePool, getPool } from "../pool.js";
import { viewCustomerDocumentGrant } from "./customer-documents.repo.js";
import { readLockedWorkorderFinancialSource } from "./customer-document-workorder-source.repo.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const digest = (value) => createHash("sha256").update(String(value)).digest("hex");
after(async () => { if (enabled) await closePool(); });

async function rejectedAtSavepoint(client, statement, params, expected) {
  await client.query("savepoint expected_failure");
  try {
    await assert.rejects(client.query(statement, params), expected);
  } finally {
    await client.query("rollback to savepoint expected_failure");
    await client.query("release savepoint expected_failure");
  }
}

test("real PostgreSQL enforces immutable revisions, exact tenant scope, hashed grants, and one response", { skip: !enabled }, async () => {
  const client = await getPool().connect();
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const locationId = randomUUID();
  const otherLocationId = randomUUID();
  const actorId = randomUUID();
  const draftId = randomUUID();
  const wrongScopeDraftId = randomUUID();
  const taxProfileId = randomUUID();
  const taxVersionId = randomUUID();
  const profileId = randomUUID();
  const profileVersionId = randomUUID();
  const seriesId = randomUUID();
  const documentId = randomUUID();
  const revisionId = randomUUID();
  const grantId = randomUUID();
  const contentHash = digest("document-content");
  try {
    await client.query("begin");
    await client.query("insert into user_profiles(id,display_name) values($1,'Customer document PG test')", [actorId]);
    await client.query(
      "insert into companies(id,slug,name) values($1,$2,'Customer docs'),($3,$4,'Other customer docs')",
      [companyId, `customer-docs-${companyId}`, otherCompanyId, `customer-docs-${otherCompanyId}`],
    );
    await client.query(
      "insert into locations(id,company_id,name) values($1,$2,'Customer docs shop'),($3,$4,'Other shop')",
      [locationId, companyId, otherLocationId, otherCompanyId],
    );
    await client.query(
      `insert into workorder_drafts(
         id,company_id,location_id,created_by_user_id,owner_user_id,last_edited_by_user_id,payload
       ) values($1,$2,$3,$5,$5,$5,'{}'::jsonb),($4,$2,$3,$5,$5,$5,'{}'::jsonb)`,
      [draftId, companyId, locationId, wrongScopeDraftId, actorId],
    );
    await client.query("insert into inventory_tax_profiles(id,company_id) values($1,$2)", [taxProfileId, companyId]);
    await client.query(
      `insert into inventory_tax_profile_versions(
         id,company_id,profile_id,version,name,currency,jurisdiction,components,state,reason,
         created_by,idempotency_key,request_hash
       ) values($1,$2,$3,1,'Customer docs tax','USD','Test jurisdiction',
         '[{"name":"Tax","rate":"5.00","compound":false}]'::jsonb,'active','Test tax profile',$4,$5,$6)`,
      [taxVersionId, companyId, taxProfileId, actorId, `tax-${randomUUID()}`, digest("tax")],
    );
    await client.query(
      "update inventory_tax_profiles set current_version_id=$3 where company_id=$1 and id=$2",
      [companyId, taxProfileId, taxVersionId],
    );
    await client.query(
      "insert into customer_document_profiles(id,company_id,created_by_user_id) values($1,$2,$3)",
      [profileId, companyId, actorId],
    );
    await client.query(
      `insert into customer_document_profile_versions(
         id,company_id,profile_id,version,shop_identity,document_terms,authorization_text,
         discount_policy,line_tax_policy,default_currency,tax_profile_version_id,published_by_user_id,idempotency_key,request_hash
       ) values($1,$2,$3,1,'{}'::jsonb,'{}'::jsonb,'Authorize this estimate','{}'::jsonb,
         '{"labor":"exclusive","part":"exclusive","shop_supply":"exclusive","fee":"exclusive","core_charge":"exclusive","credit":"out_of_scope"}'::jsonb,
         'USD',$4,$5,$6,$7)`,
      [profileVersionId, companyId, profileId, taxVersionId, actorId, `profile-${randomUUID()}`, digest("profile")],
    );
    await client.query(
      "update customer_document_profiles set current_version_id=$3 where company_id=$1 and id=$2",
      [companyId, profileId, profileVersionId],
    );
    await client.query(
      "insert into customer_document_number_series(id,company_id,document_type,prefix) values($1,$2,'estimate','EST-')",
      [seriesId, companyId],
    );
    await client.query(
      `insert into customer_documents(
         id,company_id,location_id,draft_id,document_type,number_series_id,number_value,document_number,created_by_user_id
       ) values($1,$2,$3,$4,'estimate',$5,1,'EST-000001',$6)`,
      [documentId, companyId, locationId, draftId, seriesId, actorId],
    );
    await client.query(
      `insert into customer_document_revisions(
         id,company_id,location_id,document_id,revision_number,profile_version_id,snapshot,content_hash,
         financial_fingerprint,recipient_snapshot,currency,subtotal,discount_total,tax_total,total_amount,
         issued_by_user_id,idempotency_key,request_hash
       ) values($1,$2,$3,$4,1,$5,'{"document":{"state":"issued"}}'::jsonb,$6,$7,
         '{"name":"Customer","channel":"copy_link"}'::jsonb,'USD',100,0,5,105,$8,$9,$10)`,
      [revisionId, companyId, locationId, documentId, profileVersionId, contentHash, digest("financial"),
        actorId, `issue-${randomUUID()}`, digest("issue")],
    );
    await client.query(
      `insert into customer_document_events(
         company_id,location_id,document_id,revision_id,revision_hash,event_type,actor_type,
         actor_user_id,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,'issued','staff',$6,$7,$8)`,
      [companyId, locationId, documentId, revisionId, contentHash, actorId, `issued-${randomUUID()}`, digest("issued")],
    );

    await rejectedAtSavepoint(
      client,
      "update customer_document_revisions set total_amount=999 where id=$1",
      [revisionId],
      (error) => error?.code === "55000",
    );
    await rejectedAtSavepoint(
      client,
      `insert into customer_documents(
         company_id,location_id,draft_id,document_type,number_series_id,number_value,document_number,created_by_user_id
       ) values($1,$2,$3,'estimate',$4,2,'EST-000002',$5)`,
      [companyId, otherLocationId, wrongScopeDraftId, seriesId, actorId],
      (error) => error?.code === "23503",
    );

    const rawToken = `portal-${randomUUID()}-${randomUUID()}`;
    const tokenHash = digest(rawToken);
    await client.query(
      `insert into customer_document_access_grants(
         id,company_id,location_id,document_id,revision_id,token_hash,token_hint,allowed_actions,
         issued_by_user_id,expires_at,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,$6,$7,array['view_revision','respond_revision'],$8,now()+interval '1 hour',$9,$10)`,
      [grantId, companyId, locationId, documentId, revisionId, tokenHash, rawToken.slice(-8), actorId,
        `grant-${randomUUID()}`, digest("grant")],
    );
    assert.equal((await client.query(
      "select count(*)::int as count from customer_document_access_grants where token_hash=$1",
      [tokenHash],
    )).rows[0].count, 1);
    assert.equal((await client.query(
      "select count(*)::int as count from customer_document_access_grants where token_hash=$1",
      [rawToken],
    )).rows[0].count, 0);
    const viewed = await viewCustomerDocumentGrant({
      rawToken,
      idempotencyKey: `view-${randomUUID()}`,
      requestHash: digest("view-request"),
    }, { client });
    assert.equal(viewed.revision.id, revisionId);
    assert.equal((await client.query(
      "select last_used_at is not null as used from customer_document_access_grants where id=$1",
      [grantId],
    )).rows[0].used, true);
    await viewCustomerDocumentGrant({
      rawToken,
      idempotencyKey: `view-${randomUUID()}`,
      requestHash: digest("view-poll-request"),
    }, { client });
    assert.equal((await client.query(
      "select count(*)::int count from customer_document_events where access_grant_id=$1 and event_type='viewed'",
      [grantId],
    )).rows[0].count, 1);

    for (const scenario of ["no_capability", "expired", "revoked"]) {
      const scenarioGrantId = randomUUID();
      const scenarioTokenHash = digest(`${scenario}-${rawToken}`);
      const actions = scenario === "no_capability" ? "array['view_revision']" : "array['view_revision','respond_revision']";
      const issuedAt = scenario === "expired" ? "now()-interval '2 hours'" : "now()";
      const expiresAt = scenario === "expired" ? "now()-interval '1 hour'" : "now()+interval '1 hour'";
      const revoked = scenario === "revoked"
        ? ",revoked_at,revoked_by_user_id,revocation_reason"
        : "";
      const revokedValues = scenario === "revoked" ? ",now(),$7,'Revoked test grant'" : "";
      await client.query(
        `insert into customer_document_access_grants(
           id,company_id,location_id,document_id,revision_id,token_hash,token_hint,allowed_actions,
           issued_by_user_id,issued_at,expires_at,idempotency_key,request_hash${revoked}
         ) values($1,$2,$3,$4,$5,$6,'scenario',${actions},$7,${issuedAt},${expiresAt},$8,$9${revokedValues})`,
        [scenarioGrantId, companyId, locationId, documentId, revisionId, scenarioTokenHash,
          actorId, `${scenario}-${randomUUID()}`, digest(scenario)],
      );
      await rejectedAtSavepoint(
        client,
        `insert into customer_document_events(
           company_id,location_id,document_id,revision_id,revision_hash,event_type,actor_type,
           access_grant_id,displayed_amount,currency,idempotency_key,request_hash
         ) values($1,$2,$3,$4,$5,'accepted','customer',$6,105,'USD',$7,$8)`,
        [companyId, locationId, documentId, revisionId, contentHash, scenarioGrantId,
          `response-${randomUUID()}`, digest(`response-${scenario}`)],
        (error) => error?.code === "42501",
      );
    }

    await client.query(
      `insert into customer_document_events(
         company_id,location_id,document_id,revision_id,revision_hash,event_type,actor_type,
         access_grant_id,displayed_amount,currency,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,'accepted','customer',$6,105,'USD',$7,$8)`,
      [companyId, locationId, documentId, revisionId, contentHash, grantId,
        `response-${randomUUID()}`, digest("accepted")],
    );
    await rejectedAtSavepoint(
      client,
      `insert into customer_document_events(
         company_id,location_id,document_id,revision_id,revision_hash,event_type,actor_type,
         access_grant_id,displayed_amount,currency,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,'declined','customer',$6,105,'USD',$7,$8)`,
      [companyId, locationId, documentId, revisionId, contentHash, grantId,
        `response-${randomUUID()}`, digest("declined")],
      (error) => error?.code === "23505" && error?.constraint === "customer_document_event_terminal_response_uidx",
    );

    const secondRevisionId = randomUUID();
    const secondContentHash = digest("document-content-r2");
    await client.query(
      `insert into customer_document_revisions(
         id,company_id,location_id,document_id,revision_number,predecessor_revision_id,profile_version_id,
         snapshot,content_hash,financial_fingerprint,recipient_snapshot,currency,subtotal,discount_total,
         tax_total,total_amount,issued_by_user_id,idempotency_key,request_hash
       ) values($1,$2,$3,$4,2,$5,$6,'{"document":{"state":"issued"}}'::jsonb,$7,$8,
         '{"name":"Customer","channel":"copy_link"}'::jsonb,'USD',110,0,5.5,115.5,$9,$10,$11)`,
      [secondRevisionId, companyId, locationId, documentId, revisionId, profileVersionId,
        secondContentHash, digest("financial-r2"), actorId, `issue-${randomUUID()}`, digest("issue-r2")],
    );
    await client.query(
      `insert into customer_document_events(
         company_id,location_id,document_id,revision_id,revision_hash,event_type,actor_type,
         actor_user_id,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,'superseded','staff',$6,$7,$8)`,
      [companyId, locationId, documentId, revisionId, contentHash, actorId,
        `supersede-${randomUUID()}`, digest("supersede")],
    );
    await rejectedAtSavepoint(
      client,
      `insert into customer_document_events(
         company_id,location_id,document_id,revision_id,revision_hash,event_type,actor_type,
         access_grant_id,displayed_amount,currency,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,'changes_requested','customer',$6,105,'USD',$7,$8)`,
      [companyId, locationId, documentId, revisionId, contentHash, grantId,
        `response-${randomUUID()}`, digest("stale-response")],
      (error) => error?.code === "40001",
    );
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
});

test("real PostgreSQL Workorder actuals use one locked version and reject a concurrent source race", { skip: !enabled }, async () => {
  const pool = getPool();
  const setup = await pool.connect();
  const companyId = randomUUID();
  const locationId = randomUUID();
  const actorId = randomUUID();
  const workorderId = randomUUID();
  const laborProductId = randomUUID();
  const rateId = randomUUID();
  try {
    await setup.query("begin");
    await setup.query("insert into user_profiles(id,display_name) values($1,'Actual source PG test')", [actorId]);
    await setup.query("insert into companies(id,slug,name) values($1,$2,'Actual source tenant')", [companyId, `actual-${companyId}`]);
    await setup.query("insert into locations(id,company_id,name) values($1,$2,'Actual source shop')", [locationId, companyId]);
    await setup.query(
      `insert into operational_workorders(id,company_id,serial,location_id,created_by_user_id,status,concern,work_performed,form_data,mechanic_done_at)
       values($1,$2,$3,$4,$5,'mechanic_done','Repair brakes','Repaired brakes',$6::jsonb,now())`,
      [workorderId, companyId, `WO-${randomUUID()}`, locationId, actorId,
        JSON.stringify({ customerCompanyName: "Customer", unitNo: "T-1", laborHours: "2", laborProduct: { productId: laborProductId } })],
    );
    await setup.query(
      `insert into local_labor_products(id,company_id,name,normalized_name,code,normalized_code,description,created_by_user_id)
       values($1,$2,'Repair labor','repair labor','LABOR','LABOR','Repair labor',$3)`,
      [laborProductId, companyId, actorId],
    );
    await setup.query(
      `insert into labor_rate_versions(id,company_id,location_id,labor_product_id,price_kind,version,amount,currency,reason,created_by,idempotency_key,request_hash)
       values($1,$2,$3,$4,'selling_price',1,100,'USD','PG actual rate',$5,$6,$7)`,
      [rateId, companyId, locationId, laborProductId, actorId, `rate-${randomUUID()}`, digest("actual-rate")],
    );
    await setup.query(
      `insert into workorder_labor_price_snapshots(company_id,workorder_id,labor_product_id,rate_version_id,selection,hours,unit_price,total_price,currency,created_by,reason,idempotency_key,request_hash)
       values($1,$2,$3,$4,'selling_price',2,100,200,'USD',$5,'PG actual snapshot',$6,$7)`,
      [companyId, workorderId, laborProductId, rateId, actorId, `snapshot-${randomUUID()}`, digest("actual-snapshot")],
    );
    await setup.query("commit");
  } finally {
    setup.release();
  }

  const reader = await pool.connect();
  try {
    await reader.query("begin");
    const source = await readLockedWorkorderFinancialSource({ companyId, locationId, workorderId }, reader);
    assert.equal(source.workorder.status, "mechanic_done");
    assert.equal(source.labor.totalPrice, "200.0000");
    assert.match(source.pricingFingerprint, /^[0-9a-f]{64}$/);
    await reader.query("rollback");

    await reader.query("begin");
    await reader.query("select id from operational_workorders where id=$1 for update", [workorderId]);
    const competing = await pool.connect();
    try {
      await competing.query("begin");
      await competing.query("set local lock_timeout='100ms'");
      await assert.rejects(
        readLockedWorkorderFinancialSource({ companyId, locationId, workorderId }, competing),
        (error) => error.code === "55P03",
      );
      await competing.query("rollback");
    } finally {
      competing.release();
    }
    await reader.query("rollback");
  } finally {
    await reader.query("rollback").catch(() => {});
    reader.release();
    await pool.query("delete from workorder_labor_price_snapshots where company_id=$1", [companyId]);
    await pool.query("delete from operational_workorders where company_id=$1", [companyId]);
    await pool.query("delete from labor_rate_versions where company_id=$1", [companyId]);
    await pool.query("delete from local_labor_products where company_id=$1", [companyId]);
    await pool.query("delete from locations where company_id=$1", [companyId]);
    await pool.query("delete from companies where id=$1", [companyId]);
    await pool.query("delete from user_profiles where id=$1", [actorId]);
  }
});
