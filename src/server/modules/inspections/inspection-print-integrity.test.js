import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectionPrintSnapshotDigest,
  normalizeInspectionPrintSnapshot,
  verifyInspectionPrintSnapshot,
} from "./inspection-print-integrity.js";

test("canonical print digest survives Date normalization and JSONB-like readback", () => {
  const snapshot = {
    completedAt: new Date("2026-09-02T12:00:00.000Z"),
    nested: { generatedAt: new Date("2026-09-02T12:01:00.000Z") },
  };
  const normalized = normalizeInspectionPrintSnapshot(snapshot);
  const readback = JSON.parse(JSON.stringify(normalized));

  assert.deepEqual(normalized, {
    completedAt: "2026-09-02T12:00:00.000Z",
    nested: { generatedAt: "2026-09-02T12:01:00.000Z" },
  });
  assert.equal(inspectionPrintSnapshotDigest(normalized), inspectionPrintSnapshotDigest(readback));
  assert.deepEqual(verifyInspectionPrintSnapshot(readback, inspectionPrintSnapshotDigest(normalized)), {
    valid: true,
    legacy: false,
    canonicalDigest: inspectionPrintSnapshotDigest(normalized),
  });
});

test("legacy verification accepts only the confirmed root completedAt Date-to-empty-object digest", () => {
  const snapshot = {
    completedAt: "2026-09-02T12:00:00.000Z",
    inspectionNumber: "INS-1",
    nested: { generatedAt: "2026-09-02T12:01:00.000Z" },
  };
  const confirmedLegacyShape = { ...snapshot, completedAt: {} };
  const legacyDigest = inspectionPrintSnapshotDigest(confirmedLegacyShape);

  assert.deepEqual(verifyInspectionPrintSnapshot(snapshot, legacyDigest), {
    valid: true,
    legacy: true,
    legacyFormat: "completed_at_date_empty_object_v1",
    canonicalDigest: inspectionPrintSnapshotDigest(snapshot),
  });
  assert.equal(verifyInspectionPrintSnapshot(snapshot, inspectionPrintSnapshotDigest({ ...snapshot, nested: {} })).valid, false);
  assert.equal(verifyInspectionPrintSnapshot({ ...snapshot, completedAt: "not-an-iso-date" }, legacyDigest).valid, false);
});
