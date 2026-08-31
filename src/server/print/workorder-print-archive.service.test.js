import assert from "node:assert/strict";
import test from "node:test";
import { renderWorkorderDocument } from "../../../shared/workorder-template.js";
import {
  containedStoragePath,
  createArchivedWorkorderPrint,
  findArchivedPrintForWorkorder,
  listArchivedPrints,
  readArchivedPdf,
  sha256,
} from "./workorder-print-archive.service.js";

const ROOT = "/var/app/printed-workorders";
const context = {
  actor: { id: "11111111-1111-4111-8111-111111111111", role: "office" },
  companyIds: new Set(["22222222-2222-4222-8222-222222222222"]),
  locationIds: new Set(["33333333-3333-4333-8333-333333333333"]),
};
const workorder = {
  id: "44444444-4444-4444-8444-444444444444",
  companyId: [...context.companyIds][0],
  locationId: [...context.locationIds][0],
  serial: "WO-000123",
  location: { name: "Chino" },
};

function baseDependencies(overrides = {}) {
  return {
    outputDir: ROOT,
    withSnapshotLock: async (_input, loadSnapshot) => loadSnapshot(),
    requireWorkorderAccess: async () => workorder,
    buildPrintForm: async () => ({ headerTitle: "WORK ORDER", parts: [{ partNo: "P-1", serialNumber: "S-1" }] }),
    readFile: async () => Buffer.from("pdf bytes"),
    writePdf: async () => `${ROOT}/company/archive.pdf`,
    failArchive: async () => {},
    ...overrides,
  };
}

test("creates one immutable original snapshot and persists its byte hash without exposing a path", async () => {
  let claimed;
  let completed;
  const dependencies = baseDependencies({
    claimArchive: async (input) => {
      claimed = input;
      return { created: true, archive: { id: "archive-1", ...input, leaseToken: "66666666-6666-4666-8666-666666666666", status: "pending", revisionNumber: 1 } };
    },
    completeArchive: async (input) => {
      completed = input;
      return { id: "archive-1", companyId: workorder.companyId, workorderSerial: workorder.serial, status: "ready", revisionNumber: 1 };
    },
  });
  const result = await createArchivedWorkorderPrint({ workorderId: workorder.id, count: 3, idempotencyKey: "print-key-0001" }, context, dependencies);

  assert.equal(claimed.locationId, workorder.locationId);
  assert.equal(claimed.actorId, context.actor.id);
  assert.equal(claimed.snapshot.form.parts[0].serialNumber, "S-1");
  assert.equal(claimed.snapshot.copyCount, 3);
  assert.equal(claimed.leaseSeconds, 120);
  assert.equal(claimed.snapshotSha256, sha256(JSON.stringify(claimed.snapshot)));
  assert.equal(completed.storageKey, "company/archive.pdf");
  assert.equal(completed.leaseToken, "66666666-6666-4666-8666-666666666666");
  assert.equal(completed.pdfSha256, sha256(Buffer.from("pdf bytes")));
  assert.equal(completed.pdfByteSize, 9);
  assert.equal("storageKey" in result.archive, false);
});

test("revisions require lineage and receive a visible REVISED marker", async () => {
  let claimed;
  const dependencies = baseDependencies({
    claimArchive: async (input) => {
      claimed = input;
      return { created: false, archive: { id: "archive-2", status: "ready", revisionNumber: 2, workorderSerial: workorder.serial } };
    },
  });
  const result = await createArchivedWorkorderPrint({
    workorderId: workorder.id,
    artifactKind: "revised",
    predecessorArchiveId: "archive-1",
    revisionReason: "Corrected mechanic narrative",
    count: 1,
    idempotencyKey: "print-key-0002",
  }, context, dependencies);

  assert.equal(claimed.predecessorArchiveId, "archive-1");
  assert.equal(claimed.revisionReason, "Corrected mechanic narrative");
  assert.equal(claimed.snapshot.form.headerTitle, "REVISED — WORK ORDER");
  assert.match(renderWorkorderDocument(claimed.snapshot.form, [workorder.serial]), /REVISED — WORK ORDER/);
  assert.equal(result.replayed, true);
});

test("idempotency key and bounded copy count are mandatory and copy count changes the request hash", async () => {
  await assert.rejects(
    createArchivedWorkorderPrint({ workorderId: workorder.id, count: 1 }, context, baseDependencies()),
    (error) => error.statusCode === 400 && /idempotencyKey is required/.test(error.message),
  );
  for (const count of [0, 1.5, 251]) {
    await assert.rejects(
      createArchivedWorkorderPrint({ workorderId: workorder.id, count, idempotencyKey: "print-key-count" }, context, baseDependencies()),
      (error) => error.statusCode === 400 && /count must be an integer/.test(error.message),
    );
  }
  const hashes = [];
  const dependencies = baseDependencies({
    claimArchive: async (input) => {
      hashes.push(input.requestSha256);
      return { created: false, archive: { id: "archive-1", status: "ready", revisionNumber: 1, workorderSerial: workorder.serial, snapshot: input.snapshot } };
    },
  });
  await createArchivedWorkorderPrint({ workorderId: workorder.id, count: 1, idempotencyKey: "print-count-one" }, context, dependencies);
  await createArchivedWorkorderPrint({ workorderId: workorder.id, count: 2, idempotencyKey: "print-count-two" }, context, dependencies);
  assert.notEqual(hashes[0], hashes[1]);
});

test("archive containment rejects sibling-prefix and traversal paths", () => {
  assert.equal(containedStoragePath(ROOT, "company/one.pdf"), `${ROOT}/company/one.pdf`);
  assert.equal(containedStoragePath(ROOT, "../printed-workorders-evil/one.pdf"), null);
  assert.equal(containedStoragePath(ROOT, "/var/app/printed-workorders-evil/one.pdf"), null);
  assert.equal(containedStoragePath(ROOT, ""), null);
});

test("authorized missing and tampered artifacts fail integrity checks", async () => {
  const archive = {
    id: "archive-1", workorderId: workorder.id, status: "ready", storageKey: "company/archive.pdf",
    pdfByteSize: 9, pdfSha256: sha256(Buffer.from("pdf bytes")), workorderSerial: workorder.serial,
    artifactKind: "original", revisionNumber: 1,
  };
  await assert.rejects(
    readArchivedPdf("archive-1", context, baseDependencies({
      findArchive: async () => archive,
      readFile: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
    })),
    (error) => error.code === "PRINT_ARCHIVE_INTEGRITY_FAILURE" && error.statusCode === 409,
  );
  await assert.rejects(
    readArchivedPdf("archive-1", context, baseDependencies({
      findArchive: async () => archive,
      readFile: async () => Buffer.from("tampered!"),
    })),
    (error) => error.code === "PRINT_ARCHIVE_INTEGRITY_FAILURE" && error.statusCode === 409,
  );
});

test("unknown or out-of-scope ids remain indistinguishable 404 before artifact checks", async () => {
  let accessed = false;
  await assert.rejects(
    readArchivedPdf("guessed", context, baseDependencies({
      findArchive: async () => null,
      requireWorkorderAccess: async () => { accessed = true; },
    })),
    (error) => error.statusCode === 404 && error.code === "RESOURCE_NOT_FOUND",
  );
  assert.equal(accessed, false);
});

test("archive lists derive tenant and location scope and never contain a storage path", async () => {
  let scope;
  const rows = await listArchivedPrints(context, {
    listArchives: async (input) => {
      scope = input;
      return [{ id: "archive-1", workorderSerial: workorder.serial, status: "ready", createdAt: "2026-08-31T00:00:00Z", snapshot: { copyCount: 4, private: true } }];
    },
  });
  assert.deepEqual(scope.companyIds, [...context.companyIds]);
  assert.deepEqual(scope.locationIds, [...context.locationIds]);
  assert.equal(scope.isAdmin, false);
  assert.equal(rows[0].downloadUrl, "/api/jobs/archive-1/pdf");
  assert.equal("storageKey" in rows[0], false);
  assert.equal("snapshot" in rows[0], false);
  assert.equal(rows[0].copyCount, 4);
});

test("workorder archive lookup is scoped by exact artifact kind and redacts its snapshot", async () => {
  let scope;
  const archive = await findArchivedPrintForWorkorder(workorder.id, "original", context, baseDependencies({
    findLatestArchive: async (input) => {
      scope = input;
      return {
        id: "archive-original", workorderId: workorder.id, workorderSerial: workorder.serial,
        artifactKind: "original", status: "ready", snapshot: { copyCount: 2, private: true },
      };
    },
  }));
  assert.equal(scope.artifactKind, "original");
  assert.deepEqual(scope.locationIds, [...context.locationIds]);
  assert.equal(archive.id, "archive-original");
  assert.equal(archive.copyCount, 2);
  assert.equal("snapshot" in archive, false);
});

test("print snapshot access explicitly requires location membership", async () => {
  let accessOptions;
  await assert.rejects(createArchivedWorkorderPrint({
      workorderId: workorder.id, count: 1, idempotencyKey: "print-location-guard",
    }, context, baseDependencies({
      requireWorkorderAccess: async (_context, _workorderId, options) => {
        accessOptions = options;
        const error = new Error("Workorder not found");
        error.statusCode = 404;
        throw error;
      },
    })),
    (error) => error.statusCode === 404,
  );
  assert.equal(accessOptions.requireLocationMembership, true);
});
