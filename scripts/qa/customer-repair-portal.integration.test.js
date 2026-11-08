import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { seedMaintenanceFixture } from "./inspection-maintenance-fixture.js";
import { seedWorkorderDocumentsFixture } from "./workorder-documents-fixture.js";
import { getPool, closePool } from "../../src/server/db/pool.js";
import { permissionsForRole } from "../../src/server/auth/permissions.js";
import * as service from "../../src/server/modules/customer-repair-portal/customer-repair-portal.service.js";
import { issueCustomerDocumentRevision } from "../../src/server/db/repositories/customer-documents.repo.js";
import { canonicalFinancialHash } from "../../src/server/modules/customer-documents/customer-financial-calculator.js";
const enabled = process.env.RUN_CUSTOMER_REPAIR_INTEGRATION === "1";
function assertDisposable() {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/inspection_maintenance_test_[a-f0-9]{32}$/);
}
test(
  "repair link PostgreSQL lifecycle: tenant/RBAC/expiry/revocation, exact approval, chat, email and migration replay",
  { skip: !enabled },
  async () => {
    assertDisposable();
    const pool = getPool();
    try {
      const f = await seedMaintenanceFixture(pool);
      await pool.query(
        "update user_company_memberships set company_id=$2,role='admin' where user_id=$1",
        [f.otherOfficeId, f.companyId],
      );
      const doc = await seedWorkorderDocumentsFixture(pool, f);
      await pool.query(
        "update workorder_drafts set authorization_classification='required_external_customer' where id=$1",
        [doc.draftId],
      );
      const ctx = (
        role = "office",
        companyId = f.companyId,
        locations = [f.locationId],
      ) => ({
        actor: { id: f.officeId, role },
        companyIds: new Set([companyId]),
        companyRoles: new Map([[companyId, role]]),
        locationIds: new Set(locations),
        permissions: permissionsForRole(role),
      });
      const scope = { companyId: f.companyId, locationId: f.locationId };
      const grantInput = () => ({
        ...scope,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        idempotencyKey: randomUUID(),
      });
      const original = grantInput();
      const link = await service.createCustomerRepairLink(
        ctx(),
        doc.workorderId,
        original,
      );
      assert.match(link.rawToken, /^[A-Za-z0-9_-]{43}$/);
      assert.match(link.link, /#customerRepair=/);
      const replay = await service.createCustomerRepairLink(
        ctx(),
        doc.workorderId,
        original,
      );
      assert.equal(replay.rawToken, null);
      assert.equal(replay.grant.id, link.grant.id);
      const stored = (
        await pool.query(
          "select * from customer_repair_access_grants where id=$1",
          [link.grant.id],
        )
      ).rows[0];
      assert.notEqual(stored.token_hash, link.rawToken);
      assert.ok(!JSON.stringify(stored).includes(link.rawToken));
      await assert.rejects(
        service.createCustomerRepairLink(
          ctx("mechanic"),
          doc.workorderId,
          grantInput(),
        ),
        (e) => e.statusCode === 403,
      );
      await assert.rejects(
        service.createCustomerRepairLink(
          ctx("office", f.otherCompanyId),
          doc.workorderId,
          grantInput(),
        ),
        (e) => e.statusCode === 404,
      );
      await assert.rejects(
        service.createCustomerRepairLink(
          ctx("office", f.companyId, []),
          doc.workorderId,
          grantInput(),
        ),
        (e) => e.statusCode === 403,
      );
      await assert.rejects(
        service.createCustomerRepairLink(ctx(), randomUUID(), grantInput()),
        (e) => e.statusCode === 404,
      );
      await assert.rejects(
        service.readCustomerRepairPortal("x".repeat(43)),
        (e) => e.statusCode === 404,
      );
      const initial = await service.readCustomerRepairPortal(link.rawToken);
      assert.equal(initial.documents.estimate.revisionId, doc.revisionId);
      assert.equal(initial.documents.estimate.canRespond, true);
      assert.equal(initial.documents.invoice, null);
      assert.equal(initial.workorder.status, "Ready to start");
      assert.equal(initial.documents.estimate.document.totals.total, "100.00");
      assert.ok(!JSON.stringify(initial).includes("sourceEvidence"));
      // Internal audience is never visible through a repair link.
      await pool.query(
        "insert into chat_messages(workorder_id,sender_role,message_type,body) values($1,'system','system','private internal evidence')",
        [doc.workorderId],
      );
      await service.sendStaffRepairChat(ctx(), doc.workorderId, {
        ...scope,
        body: "Shop update before revision",
        idempotencyKey: randomUUID(),
      });
      const sent = await service.sendCustomerRepairChat(link.rawToken, {
        body: "Customer question",
        customerName: "Sam",
        idempotencyKey: "customer-message-01",
      });
      assert.ok(sent.message.id);
      const replayChat = await service.sendCustomerRepairChat(link.rawToken, {
        body: "Customer question",
        customerName: "Sam",
        idempotencyKey: "customer-message-01",
      });
      assert.equal(replayChat.replayed, true);
      await assert.rejects(
        service.sendCustomerRepairChat(link.rawToken, {
          body: "Changed replay",
          customerName: "Sam",
          idempotencyKey: "customer-message-01",
        }),
        (e) => e.statusCode === 409,
      );
      const first = (
        await pool.query(
          "select * from customer_document_revisions where id=$1",
          [doc.revisionId],
        )
      ).rows[0];
      const snapshot = { ...first.snapshot, concern: "Updated repair scope" };
      const updated = await issueCustomerDocumentRevision(
        {
          companyId: f.companyId,
          locationId: f.locationId,
          draftId: doc.draftId,
          workorderId: doc.workorderId,
          documentId: doc.documentId,
          documentType: "estimate",
          predecessorRevisionId: doc.revisionId,
          profileVersionId: doc.profileVersionId,
          snapshot,
          contentHash: canonicalFinancialHash(snapshot),
          financialFingerprint: first.financial_fingerprint,
          recipientSnapshot: first.recipient_snapshot,
          currency: first.currency,
          subtotal: snapshot.totals.subtotal,
          discountTotal: snapshot.totals.discountTotal,
          taxTotal: snapshot.totals.tax,
          totalAmount: snapshot.totals.total,
          actorId: f.officeId,
          idempotencyKey: randomUUID(),
          requestHash: canonicalFinancialHash({ key: randomUUID() }),
        },
        { pool },
      );
      await assert.rejects(
        service.respondToCustomerRepairEstimate(link.rawToken, {
          revisionId: doc.revisionId,
          response: "accepted",
          customerName: "Sam",
          idempotencyKey: randomUUID(),
        }),
        (e) => e.statusCode === 409,
      );
      const current = await service.readCustomerRepairPortal(link.rawToken);
      assert.equal(current.documents.estimate.revisionId, updated.revision.id);
      assert.equal(current.history.length, 2);
      const accepted = await service.respondToCustomerRepairEstimate(
        link.rawToken,
        {
          revisionId: updated.revision.id,
          response: "accepted",
          customerName: "Sam",
          idempotencyKey: "approve-current-01",
        },
      );
      assert.equal(accepted.responseType, "accepted");
      const acceptedReplay = await service.respondToCustomerRepairEstimate(
        link.rawToken,
        {
          revisionId: updated.revision.id,
          response: "accepted",
          customerName: "Sam",
          idempotencyKey: "approve-current-01",
        },
      );
      assert.equal(acceptedReplay.replayed, true);
      const approved = await service.readCustomerRepairPortal(link.rawToken);
      assert.equal(approved.documents.estimate.canRespond, false);
      assert.equal(approved.documents.estimate.response.status, "accepted");
      const chat = await service.readCustomerRepairChat(link.rawToken);
      assert.equal(chat.messages.length, 2);
      assert.ok(!JSON.stringify(chat).includes("private internal evidence"));
      const staffChat = await service.readStaffRepairChat(
        ctx(),
        doc.workorderId,
        scope,
      );
      assert.equal(staffChat.messages.length, 2);
      let sends = 0;
      const emailInput = {
        ...scope,
        workorderId: doc.workorderId,
        rawToken: link.rawToken,
        recipientEmail: "customer@example.com",
        idempotencyKey: "email-attempt-001",
      };
      const mailer = {
        enabled: true,
        send: async (message) => {
          sends++;
          assert.match(message.text, /#customerRepair=/);
          return { accepted: ["customer@example.com"] };
        },
      };
      assert.equal(
        (
          await service.emailCustomerRepairLink(
            ctx(),
            link.grant.id,
            emailInput,
            { mailer },
          )
        ).providerAccepted,
        true,
      );
      assert.equal(
        (
          await service.emailCustomerRepairLink(
            ctx(),
            link.grant.id,
            emailInput,
            { mailer },
          )
        ).replayed,
        true,
      );
      assert.equal(sends, 1);
      assert.equal(
        (
          await service.emailCustomerRepairLink(
            ctx(),
            link.grant.id,
            { ...emailInput, idempotencyKey: "email-disabled-01" },
            { mailer: { enabled: false } },
          )
        ).status,
        "not_configured",
      );
      assert.equal(
        (
          await service.emailCustomerRepairLink(
            ctx(),
            link.grant.id,
            { ...emailInput, idempotencyKey: "email-failure-001" },
            {
              mailer: {
                enabled: true,
                send: async () => {
                  throw Error("fake unavailable");
                },
              },
            },
          )
        ).status,
        "requested",
      );
      let uncertainSends = 0;
      const uncertainMailer = { enabled: true, send: async () => { uncertainSends++; throw Error("accepted then connection lost"); } };
      const uncertainInput = { ...emailInput, idempotencyKey: "uncertain-email-retry" };
      const uncertainFirst = await service.emailCustomerRepairLink(ctx(), link.grant.id, uncertainInput, { mailer: uncertainMailer });
      assert.equal(uncertainFirst.status, "requested");
      const uncertainRetry = await service.emailCustomerRepairLink(ctx(), link.grant.id, uncertainInput, { mailer: uncertainMailer });
      assert.equal(uncertainRetry.status, "requested");
      assert.equal(uncertainRetry.replayed, true);
      assert.equal(uncertainSends, 1, "Unknown SMTP outcome must not send again on retry");
      await assert.rejects(
        service.emailCustomerRepairLink(ctx(), link.grant.id, {
          ...emailInput,
          workorderId: randomUUID(),
        }),
        (e) => e.statusCode === 404,
      );
      await service.revokeCustomerRepairLink(ctx(), link.grant.id, {
        ...scope,
        workorderId: doc.workorderId,
      });
      await assert.rejects(
        service.readCustomerRepairPortal(link.rawToken),
        (e) => e.statusCode === 404,
      );
      await assert.rejects(
        service.sendCustomerRepairChat(link.rawToken, {
          body: "After revoke",
          customerName: "Sam",
          idempotencyKey: randomUUID(),
        }),
        (e) => e.statusCode === 404,
      );
      await assert.rejects(
        service.respondToCustomerRepairEstimate(link.rawToken, {
          revisionId: updated.revision.id,
          response: "accepted",
          customerName: "Sam",
          idempotencyKey: randomUUID(),
        }),
        (e) => e.statusCode === 404,
      );
      await assert.rejects(
        pool.query(
          "update customer_repair_access_grants set revoked_at=null,revoked_by_user_id=null where id=$1",
          [link.grant.id],
        ),
        (e) => e.code === "55000",
      );
      // Expired fixture inserted directly; production grant creation enforces TTL.
      const expiredToken = "z".repeat(43);
      const { repairHash } = await import(
        "../../src/server/db/repositories/customer-repair-portal.repo.js"
      );
      await pool.query(
        `insert into customer_repair_access_grants(company_id,location_id,workorder_id,token_hash,token_hint,issued_by_user_id,issued_at,expires_at,idempotency_key,request_hash) values($1,$2,$3,$4,'expired',$5,now()-interval '2 days',now()-interval '1 day',$6,$7)`,
        [
          f.companyId,
          f.locationId,
          doc.workorderId,
          repairHash(expiredToken),
          f.officeId,
          randomUUID(),
          repairHash("expired"),
        ],
      );
      await assert.rejects(
        service.readCustomerRepairPortal(expiredToken),
        (e) => e.statusCode === 404,
      );
      // Reapplying the additive migration keeps legacy revision grants untouched.
      const before = Number(
        (
          await pool.query(
            "select count(*) n from customer_document_access_grants",
          )
        ).rows[0].n,
      );
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          await readFile(
            new URL(
              "../../src/server/db/migrations/205_customer_repair_portal.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        await client.query("commit");
      } finally {
        client.release();
      }
      assert.equal(
        Number(
          (
            await pool.query(
              "select count(*) n from customer_document_access_grants",
            )
          ).rows[0].n,
        ),
        before,
      );
    } finally {
      await closePool();
    }
  },
);
