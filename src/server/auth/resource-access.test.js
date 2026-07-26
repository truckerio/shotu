import assert from "node:assert/strict";
import test from "node:test";
import { requireWorkorderAccess } from "./resource-access.js";

const workorder = {
  id: "workorder-1",
  companyId: "default",
  locationId: "location-a",
  mechanicIds: ["mechanic-1", "mechanic-2"],
  status: "accepted",
};

function context(role, overrides = {}) {
  return {
    actor: { id: `${role}-1`, role },
    companyIds: new Set(["default"]),
    locationIds: new Set(["location-a"]),
    ...overrides,
  };
}

test("mechanic can only read assigned work or an available workorder", async () => {
  const getWorkorder = async () => workorder;
  assert.equal((await requireWorkorderAccess(context("mechanic"), workorder.id, { getWorkorder })).id, workorder.id);
  assert.equal((await requireWorkorderAccess(
    context("mechanic", { actor: { id: "mechanic-2", role: "mechanic" } }),
    workorder.id,
    { getWorkorder },
  )).id, workorder.id);
  await assert.rejects(
    requireWorkorderAccess(context("mechanic", { actor: { id: "mechanic-3", role: "mechanic" } }), workorder.id, { getWorkorder }),
    (error) => error.statusCode === 404,
  );
  const available = { ...workorder, mechanicIds: [], status: "open" };
  assert.equal((await requireWorkorderAccess(context("mechanic"), available.id, {
    allowAvailable: true,
    getWorkorder: async () => available,
  })).id, available.id);
});

test("company and location membership hide inaccessible workorders", async () => {
  const getWorkorder = async () => workorder;
  await assert.rejects(
    requireWorkorderAccess(context("office", { companyIds: new Set(["other"]) }), workorder.id, { getWorkorder }),
    (error) => error.statusCode === 404,
  );
  await assert.rejects(
    requireWorkorderAccess(context("office", { locationIds: new Set(["location-b"]) }), workorder.id, { getWorkorder }),
    (error) => error.statusCode === 404,
  );
});

test("admin access is still limited to assigned companies", async () => {
  const getWorkorder = async () => workorder;
  await assert.rejects(
    requireWorkorderAccess(context("admin", { companyIds: new Set(["other"]) }), workorder.id, { getWorkorder }),
    (error) => error.statusCode === 404,
  );
  assert.equal(
    (await requireWorkorderAccess(context("admin"), workorder.id, { getWorkorder })).id,
    workorder.id,
  );
});

test("surveillance reads active and completed workflow records but not unassigned work", async () => {
  assert.equal(
    (await requireWorkorderAccess(context("surveillance"), workorder.id, { getWorkorder: async () => workorder })).status,
    "accepted",
  );
  const closed = { ...workorder, status: "closed" };
  assert.equal((await requireWorkorderAccess(context("surveillance"), closed.id, { getWorkorder: async () => closed })).status, "closed");
  const open = { ...workorder, status: "open" };
  await assert.rejects(
    requireWorkorderAccess(context("surveillance"), open.id, { getWorkorder: async () => open }),
    (error) => error.statusCode === 404,
  );
});
