import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_CREATE_ASSIGNMENT,
  canLoadCreateMechanics,
  createAssignmentClearedState,
  createAssignmentLoadedState,
  createAssignmentLoadingState,
  createLoadedLocationModel,
  createLocationSelectionPatch,
  createTemplateEndpoint,
  normalizeCreateLocationResponse,
} from "./create-location-controller-model.js";

const locations = [
  {
    location: { id: "loc-arizona", name: "Arizona Yard" },
    template: { header_title: "ARIZONA WORKORDER", brand_top: "A", brand_bottom: "B" },
  },
  {
    location: { id: "loc-chino", name: "Chino Yard" },
    template: { header_title: "CHINO WORKORDER", brand_top: "PRO TEC", brand_bottom: "REPAIR" },
  },
];

test("controller keeps the established template and mechanics API contracts", () => {
  assert.equal(createTemplateEndpoint(), "/api/workorders/create-context");
});

test("location response prefers the explicit role default and normalizes missing arrays", () => {
  assert.deepEqual(normalizeCreateLocationResponse({ locations }).defaultLocationEntry, { ...locations[0], policy: null });
  assert.deepEqual(
    normalizeCreateLocationResponse({
      location: { id: "loc-chino", name: "Chino Yard" },
      locations,
      template: { header_title: "ROLE DEFAULT" },
    }).defaultLocationEntry,
    {
      location: { id: "loc-chino", name: "Chino Yard" },
      mechanics: [],
      policy: null,
      template: { header_title: "ROLE DEFAULT" },
    },
  );
  assert.deepEqual(normalizeCreateLocationResponse({ locations: null }).locations, []);
});

test("canonical create context normalizes module access and assignment choices per location", () => {
  const [entry] = normalizeCreateLocationResponse({
    locations: [{
      location: { id: "loc-1", name: "Chino" },
      mechanics: [{ id: "mech-1", name: "Mechanic 1" }],
      moduleAccess: { moduleAccess: { surveillance: { create: { concern: "required" } } } },
      template: { header_title: "CHINO" },
    }],
  }).locations;
  assert.equal(entry.policy.moduleAccess.surveillance.create.concern, "required");
  assert.deepEqual(entry.mechanics, [{ id: "mech-1", name: "Mechanic 1" }]);
});

test("loaded location model preserves a valid selection without resetting the draft baseline", () => {
  const model = createLoadedLocationModel({
    currentLocationId: "Chino Yard",
    payload: {
      location: locations[0].location,
      locations,
      template: locations[0].template,
    },
  });

  assert.deepEqual(model.patch, { locationId: "loc-chino", locationName: "Chino Yard" });
  assert.equal(model.resetDraftBaseline, false);
});

test("loaded location model applies the default template when selection is empty or invalid", () => {
  const model = createLoadedLocationModel({
    currentLocationId: "missing",
    payload: {
      location: locations[0].location,
      locations,
      template: locations[0].template,
    },
  });

  assert.equal(model.patch.locationId, "loc-arizona");
  assert.equal(model.patch.locationName, "Arizona Yard");
  assert.equal(model.patch.headerTitle, "ARIZONA WORKORDER");
  assert.equal(model.resetDraftBaseline, true);
});

test("selection patch changes location and template as one autosave-ready payload", () => {
  assert.deepEqual(createLocationSelectionPatch(locations, "loc-chino"), {
    locationId: "loc-chino",
    locationName: "Chino Yard",
    headerTitle: "CHINO WORKORDER",
    brandTop: "PRO TEC",
    brandBottom: "REPAIR",
    warrantyText: undefined,
    responsibilityText: undefined,
    authorizationText: undefined,
  });
  assert.equal(createLocationSelectionPatch(locations, "missing"), null);
});

test("canonical create context exposes allowed assignment choices for any granted role", () => {
  assert.equal(canLoadCreateMechanics({ actorRole: "admin", selectedLocationId: "loc-1" }), true);
  assert.equal(canLoadCreateMechanics({ actorRole: "office", selectedLocationId: "loc-1" }), true);
  assert.equal(canLoadCreateMechanics({ actorRole: "mechanic", selectedLocationId: "loc-1" }), true);
  assert.equal(canLoadCreateMechanics({ actorRole: "surveillance", selectedLocationId: "loc-1" }), true);
  assert.equal(canLoadCreateMechanics({ actorRole: "admin", selectedLocationId: "" }), false);
  assert.equal(canLoadCreateMechanics({ activeWorkorder: { id: "wo-1" }, actorRole: "admin", selectedLocationId: "loc-1" }), false);
});

test("assignment transitions clear stale selection during reload and preserve it when disabled", () => {
  const selected = {
    error: "old",
    loading: false,
    mechanicUserIds: ["mechanic-1"],
    mechanics: [{ id: "mechanic-1" }],
  };
  assert.deepEqual(createAssignmentLoadingState(selected), {
    error: "",
    loading: true,
    mechanicUserIds: [],
    mechanics: [{ id: "mechanic-1" }],
  });
  assert.deepEqual(createAssignmentLoadedState([{ id: "mechanic-2" }]), {
    error: "",
    loading: false,
    mechanicUserIds: [],
    mechanics: [{ id: "mechanic-2" }],
  });
  assert.deepEqual(createAssignmentClearedState(selected), {
    ...selected,
    error: "",
    loading: false,
    mechanics: [],
  });
  assert.deepEqual(createAssignmentClearedState(EMPTY_CREATE_ASSIGNMENT, "Unavailable").error, "Unavailable");
});
