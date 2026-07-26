import test from "node:test";
import assert from "node:assert/strict";
import {
  draftConcern,
  draftLocation,
  draftMatchesSearch,
  draftMissingFields,
  draftBelongsToActor,
  draftOwnerId,
  draftUnit,
} from "./workorder-draft-format.js";

const draft = {
  id: "draft-123",
  locationId: "location-1",
  location: { name: "Chino Yard" },
  createdBy: { name: "Office Demo" },
  payload: {
    assetId: "asset-1",
    concern: "Oil leak",
    formData: {
      unitNo: "G2021",
      customerCompanyName: "Long Haul",
    },
  },
};

test("draft formatters read the current payload projection", () => {
  assert.equal(draftUnit(draft), "G2021");
  assert.equal(draftConcern(draft), "Oil leak");
  assert.equal(draftLocation(draft), "Chino Yard");
  assert.deepEqual(draftMissingFields({ ...draft, locationId: null, location: null }), ["location"]);
  assert.deepEqual(draftMissingFields(draft), []);
  assert.equal(draftOwnerId({ createdByUserId: "user-1" }), "user-1");
  assert.equal(draftBelongsToActor({ ownerId: "user-1" }, "user-1"), true);
});

test("draft search matches identity, concern, and location", () => {
  assert.equal(draftMatchesSearch(draft, "g2021"), true);
  assert.equal(draftMatchesSearch(draft, "oil leak"), true);
  assert.equal(draftMatchesSearch(draft, "chino"), true);
  assert.equal(draftMatchesSearch(draft, "unrelated"), false);
});

test("incomplete drafts expose actionable missing fields", () => {
  const incomplete = { payload: { formData: {} } };
  assert.deepEqual(draftMissingFields(incomplete), ["location", "unit", "concern", "customer"]);
});
