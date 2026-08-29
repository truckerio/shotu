import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGlobalInvoiceLayoutContribution,
  canonicalGlobalLayoutPayload,
  capGlobalTemplateConfidence,
  configuredGlobalLayoutKeyrings,
  globalLayoutAsLocalTemplate,
  globalObservationMarkerDigests,
  invoiceLayoutHmac,
  matchGlobalInvoiceLayout,
  scanGlobalLayoutPayload,
} from "./invoice-global-layout.js";

const keyring = { version: "v1", keys: { v1: Buffer.alloc(32, 7) } };
const region = (text, x, y, width = 100, height = 20) => ({ text, x, y, width, height });

function fixture() {
  return {
    observation: {
      width: 1000, height: 1400,
      regions: [
        region("Invoice number", 600, 100), region("SECRET-99881", 760, 100, 150),
        region("Date", 600, 140), region("08/29/2026", 760, 140),
        region("Description", 300, 500), region("Private turbo assembly", 300, 550, 240),
        region("Quantity", 650, 500), region("7", 650, 550),
        region("Total", 700, 1000), region("$9,876.54", 850, 1000),
      ],
    },
    reviewedDraft: {
      invoiceNumber: { value: "SECRET-99881" }, invoiceDate: { value: "08/29/2026" },
      total: { value: 9876.54 }, currency: { value: "USD" }, vendorName: { value: "Private Vendor LLC" },
      lines: [{ description: { value: "Private turbo assembly" }, quantity: { value: 7 } }],
    },
  };
}

test("builds a deterministic quantized allowlist without confidential values", () => {
  const first = buildGlobalInvoiceLayoutContribution({ ...fixture(), keyring });
  const second = buildGlobalInvoiceLayoutContribution({ ...fixture(), keyring });
  assert.deepEqual(first, second);
  assert.match(first.structuralFingerprint, /^[0-9a-f]{64}$/);
  assert.ok(first.payload.signatureRegions.length >= 3);
  const serialized = JSON.stringify(first.payload);
  for (const forbidden of ["SECRET-99881", "08/29/2026", "9876.54", "Private Vendor", "turbo assembly", "USD", "staticFields", "learningMetrics"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.ok(first.payload.signatureRegions.every((item) => Number.isInteger(item.xBin) && Number.isInteger(item.yBin)));
});

test("HMAC markers are versioned, key-dependent, and fail closed", () => {
  const v1 = invoiceLayoutHmac("Invoice No.", keyring);
  const v2 = invoiceLayoutHmac("Invoice number", { version: "v2", keys: { v2: Buffer.alloc(32, 8) } });
  assert.match(v1, /^[0-9a-f]{64}$/);
  assert.notEqual(v1, v2);
  assert.throws(() => invoiceLayoutHmac("Invoice number", { version: "v2", keys: {} }), /hmac_unavailable/);
  assert.throws(() => invoiceLayoutHmac("Private Vendor LLC", keyring), /hmac_unavailable/);
  assert.notDeepEqual(globalObservationMarkerDigests(fixture().observation, keyring),
    globalObservationMarkerDigests(fixture().observation, { version: "v2", keys: { v2: Buffer.alloc(32, 8) } }));
});

test("configured keyrings prefer the active version and fail closed on malformed material", () => {
  const serializedKeys = JSON.stringify({ v1: Buffer.alloc(32, 7).toString("base64"), old: Buffer.alloc(32, 8).toString("base64") });
  assert.deepEqual(configuredGlobalLayoutKeyrings({ activeVersion: "v1", serializedKeys }).map((item) => item.version), ["v1", "old"]);
  assert.deepEqual(configuredGlobalLayoutKeyrings({ activeVersion: "v1", serializedKeys: "not-json" }), []);
  assert.deepEqual(configuredGlobalLayoutKeyrings({ activeVersion: "v1", serializedKeys: JSON.stringify({ v1: "short" }) }), []);
});

test("strict schema rejects unknown fields and global evidence caps confidence", () => {
  const built = buildGlobalInvoiceLayoutContribution({ ...fixture(), keyring });
  assert.throws(() => canonicalGlobalLayoutPayload({ ...built.payload, vendorKey: "secret" }), /unknown_field/);
  assert.throws(() => canonicalGlobalLayoutPayload({ ...built.payload, signatureRegions: [] }), /cardinality/);
  const capped = capGlobalTemplateConfidence({
    invoiceNumber: { value: "X", confidence: 99 },
    lines: [{ id: "1", quantity: { value: 2, confidence: 96 } }], warnings: [],
  });
  assert.equal(capped.invoiceNumber.confidence, 89);
  assert.equal(capped.lines[0].quantity.confidence, 89);
  assert.match(capped.warnings[0], /requires local review/i);
});

test("independent scanner rejects unrecognized and repeated HMAC geometry", () => {
  const built = buildGlobalInvoiceLayoutContribution({ ...fixture(), keyring });
  const unrecognized = structuredClone(built.payload);
  unrecognized.signatureRegions[0].markerHmac = "f".repeat(64);
  assert.throws(() => scanGlobalLayoutPayload(unrecognized, keyring), /unrecognized_marker/);

  const repeated = structuredClone(built.payload);
  repeated.signatureRegions[1].markerHmac = repeated.signatureRegions[0].markerHmac;
  assert.throws(() => scanGlobalLayoutPayload(repeated, keyring), /repeated_marker/);

  const encodedCoordinate = structuredClone(built.payload);
  encodedCoordinate.signatureRegions[0].xBin = (encodedCoordinate.signatureRegions[0].xBin + 1) % 20;
  assert.throws(() => scanGlobalLayoutPayload(encodedCoordinate, keyring), /unreviewed_grammar/);
});

test("matches compatible HMAC geometry and exposes only a review-only local projection", () => {
  const built = buildGlobalInvoiceLayoutContribution({ ...fixture(), keyring });
  assert.equal(matchGlobalInvoiceLayout(fixture().observation, built.payload, keyring).matched, true);
  assert.throws(
    () => matchGlobalInvoiceLayout(fixture().observation, built.payload, { version: "v2", keys: { v2: Buffer.alloc(32, 8) } }),
    /version_mismatch/,
  );
  const local = globalLayoutAsLocalTemplate(built.payload);
  assert.equal(local.staticFields.currency, "UNKNOWN");
  assert.equal(local.tableBounds, null);
  assert.ok(local.fieldAnchors.every((anchor) => !anchor.fieldPath.startsWith("lines.")));
  assert.equal(JSON.stringify(local).includes("SECRET-99881"), false);
});
