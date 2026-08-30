import assert from "node:assert/strict";
import test from "node:test";
import {
  attachSamsaraTags,
  fetchSamsaraFleet,
  testSamsaraClientCapabilities,
} from "./samsara.sync.service.js";

test("connection capability check requires both vehicle and tag reads", async () => {
  const calls = [];
  await testSamsaraClientCapabilities({
    async listVehiclesPage(options) {
      calls.push(["vehicles", options]);
    },
    async listTagsPage(options) {
      calls.push(["tags", options]);
    },
  });
  assert.deepEqual(calls, [
    ["vehicles", { limit: 1 }],
    ["tags", { limit: 1 }],
  ]);

  await assert.rejects(
    () => testSamsaraClientCapabilities({
      async listVehiclesPage() {},
      async listTagsPage() { throw Object.assign(new Error("missing scope"), { status: 403 }); },
    }),
    (error) => error.status === 403,
  );
});

test("tag memberships attach all matching vehicle and trailer company labels", () => {
  const result = attachSamsaraTags({
    vehicles: [{ id: "vehicle-1", tags: [{ name: "Existing" }] }],
    trailers: [{ id: "trailer-1" }],
    tags: [
      { name: "CA Local", vehicles: [{ id: "vehicle-1" }] },
      { name: "SPG", vehicles: [{ id: "vehicle-1" }], assets: [{ id: "trailer-1" }] },
      { name: "Protech", assets: [{ id: "trailer-1" }] },
      { name: "Ignore unrelated", vehicles: [{ id: "vehicle-2" }], assets: [{ id: "asset-2" }] },
    ],
  });

  assert.deepEqual(result.vehicles[0].tags, [
    { name: "Existing" },
    { name: "CA Local" },
    { name: "SPG" },
  ]);
  assert.deepEqual(result.trailers[0].tags, [
    { name: "SPG" },
    { name: "Protech" },
  ]);
});

test("tag attachment bounds and normalizes provider-controlled memberships", () => {
  const tags = [
    { name: " SPG ", vehicles: [{ id: "vehicle-1" }] },
    { name: "spg", vehicles: [{ id: "vehicle-1" }] },
    ...Array.from({ length: 40 }, (_, index) => ({
      name: `Tag ${index}`,
      vehicles: [{ id: "vehicle-1" }],
    })),
  ];
  const result = attachSamsaraTags({ vehicles: [{ id: "vehicle-1" }], tags });

  assert.equal(result.vehicles[0].tags.length, 25);
  assert.equal(result.vehicles[0].tags[0].name, "SPG");
  assert.equal(result.vehicles[0].tags.filter((tag) => tag.name.toLowerCase() === "spg").length, 1);
});

test("fleet fetch paginates identity and tags before joining memberships", async () => {
  const calls = [];
  const client = {
    async listVehiclesPage({ after }) {
      calls.push(["vehicles", after]);
      if (!after) return {
        data: [{ id: "vehicle-1" }],
        pagination: { hasNextPage: true, endCursor: "vehicle-next" },
      };
      return { data: [{ id: "vehicle-2" }], pagination: { hasNextPage: false } };
    },
    async listTagsPage({ after }) {
      calls.push(["tags", after]);
      return {
        data: [{
          name: "SPG",
          vehicles: [{ id: "vehicle-1" }, { id: "vehicle-2" }],
          assets: [{ id: "trailer-1" }],
        }],
        pagination: { hasNextPage: false },
      };
    },
    async listTrailersPage({ after }) {
      calls.push(["trailers", after]);
      return { data: [{ id: "trailer-1" }], pagination: { hasNextPage: false } };
    },
    async listVehicleStats() {
      return { data: [] };
    },
    async listTrailerStats() {
      return { data: [] };
    },
  };

  const result = await fetchSamsaraFleet(client);

  assert.deepEqual(calls.slice(0, 4), [
    ["vehicles", ""],
    ["vehicles", "vehicle-next"],
    ["tags", ""],
    ["trailers", ""],
  ]);
  assert.deepEqual(result.vehicles.map((vehicle) => vehicle.tags), [
    [{ name: "SPG" }],
    [{ name: "SPG" }],
  ]);
  assert.deepEqual(result.trailers[0].tags, [{ name: "SPG" }]);
});
