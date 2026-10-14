import assert from "node:assert/strict";
import test from "node:test";
import { createPartIdentityDraft, hasRefreshedPartIdentityVersion, MAX_REFERENCE_NUMBERS, partIdentityConflict, partIdentityPayload, trackingModeForUom, trackingModeLockedForUom, validatePartIdentityDraft } from "./part-identity-editor-model.js";

const draft = (overrides = {}) => ({ description: "Oil filter", partNumber: "LF-1", manufacturer: "Fleet", category: "Filters", barcode: "123", uomCode: "ea", trackingMode: "quantity", referenceNumbers: [], ...overrides });

test("part identity payload trims optional metadata and removes blank reference rows", () => {
  assert.deepEqual(partIdentityPayload(draft({ description: " Oil filter ", referenceNumbers: [{ value: " WIX-1 " }, { value: " " }] }), 4), {
    expectedVersion: 4, description: "Oil filter", partNumber: "LF-1", manufacturer: "Fleet", category: "Filters", barcode: "123", uomCode: "ea", trackingMode: "quantity", referenceNumbers: ["WIX-1"],
  });
});

test("part identity validation requires identity and rejects duplicate or primary-equivalent references", () => {
  const result = validatePartIdentityDraft(draft({ description: "", partNumber: "abc-1", referenceNumbers: [{ id: "one", value: "ABC-1" }, { id: "two", value: " wix " }, { id: "three", value: "WIX" }] }));
  assert.equal(result.description, "Enter a part name.");
  assert.equal(result["reference-one"], "A reference number cannot match the primary part number.");
  assert.equal(result["reference-three"], "Reference numbers must be unique.");
});

test("part identity validation treats punctuation variants as the same identity", () => {
  const draft = createPartIdentityDraft({ partNumber: "BW-1", description: "Valve", referenceNumbers: ["BW1"] });
  const errors = validatePartIdentityDraft(draft);
  assert.match(errors[`reference-${draft.referenceNumbers[0].id}`], /cannot match/i);
});

test("part identity validation enforces the bounded reference number count", () => {
  const referenceNumbers = Array.from({ length: MAX_REFERENCE_NUMBERS + 1 }, (_, index) => ({ id: String(index), value: `REF-${index}` }));
  assert.match(validatePartIdentityDraft(draft({ referenceNumbers })).referenceNumbers, /at most/);
});

test("part identity separates stale versions from editable server identity conflicts", () => {
  assert.deepEqual(partIdentityConflict({ code: "INVENTORY_PART_STALE", message: "ignored" }), {
    kind: "stale",
    message: "This part was changed elsewhere. Reload details before saving.",
  });
  assert.deepEqual(partIdentityConflict({ code: "INVENTORY_PART_IDENTITY_CONFLICT", message: "Part number is already in use." }), {
    kind: "identity",
    message: "Part number is already in use.",
  });
});

test("part identity refresh gate only releases when the selected catalog part has a newer version", () => {
  const pending = { catalogPartId: "part-1", version: 2 };
  assert.equal(hasRefreshedPartIdentityVersion({ catalogPartId: "part-1", version: 2 }, pending), false);
  assert.equal(hasRefreshedPartIdentityVersion({ catalogPartId: "part-2", version: 3 }, pending), false);
  assert.equal(hasRefreshedPartIdentityVersion({ catalogPartId: "part-1", version: 3 }, pending), true);
});

test("part identity accepts no-stock tracking and forces it for time units", () => {
  assert.deepEqual(validatePartIdentityDraft(draft({ trackingMode: "no_stock" })), {});
  assert.equal(trackingModeForUom("hr", "quantity"), "no_stock");
  assert.equal(trackingModeLockedForUom("hr"), true);
  assert.equal(trackingModeForUom("ea", "quantity"), "quantity");
  assert.equal(trackingModeLockedForUom("ea"), false);
  assert.equal(createPartIdentityDraft({ uomCode: "hr", trackingMode: "" }).trackingMode, "no_stock");
});

test("part identity preserves grandfathered physical tracking when a persisted time part opens", () => {
  const part = {
    catalogPartId: "legacy-time-part",
    version: 7,
    description: "Legacy shop time",
    partNumber: "LEGACY-HR",
    uomCode: "hr",
    trackingMode: "measured_bulk",
  };
  const persisted = createPartIdentityDraft(part);

  assert.equal(persisted.trackingMode, "measured_bulk");
  assert.equal(partIdentityPayload(persisted, part.version).trackingMode, part.trackingMode);
  assert.equal(trackingModeForUom("hr", persisted.trackingMode), "no_stock");
});
