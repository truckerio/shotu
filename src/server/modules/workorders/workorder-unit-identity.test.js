import assert from "node:assert/strict";
import test from "node:test";
import { guardImmutableWorkorderUnitIdentity } from "../../db/repositories/operational-workorders.repo.js";

const before = {
  asset_id: "11111111-1111-4111-8111-111111111111",
  form_data: { unitNo: "G2116", vinNo: "OLD-VIN", mileage: "100" },
};

test("workorder unit identity permits same-unit full-form autosaves and descriptive changes", () => {
  const formData = guardImmutableWorkorderUnitIdentity(before, {
    assetId: before.asset_id,
    formData: { unitNo: " G2116 ", vinNo: "NEW-VIN", mileage: "200", name: "Updated truck" },
  });

  assert.deepEqual(formData, { unitNo: "G2116", vinNo: "NEW-VIN", mileage: "200", name: "Updated truck" });
});

test("workorder unit identity rejects asset reassignment and a changed saved unit number", () => {
  assert.throws(
    () => guardImmutableWorkorderUnitIdentity(before, { assetId: "22222222-2222-4222-8222-222222222222" }),
    (error) => error.code === "WORKORDER_UNIT_IMMUTABLE" && error.statusCode === 409,
  );
  assert.throws(
    () => guardImmutableWorkorderUnitIdentity(before, { formData: { unitNo: "G2117" } }),
    (error) => error.code === "WORKORDER_UNIT_IMMUTABLE" && error.statusCode === 409,
  );
});

test("workorder unit identity preserves an existing snapshot when autosave omits it and leaves legacy no-unit records unchanged", () => {
  assert.deepEqual(
    guardImmutableWorkorderUnitIdentity(before, { formData: { vinNo: "NEW-VIN" } }),
    { unitNo: "G2116", vinNo: "NEW-VIN" },
  );
  assert.deepEqual(
    guardImmutableWorkorderUnitIdentity({ asset_id: null, form_data: { vinNo: "OLD-VIN" } }, { formData: { vinNo: "NEW-VIN" } }),
    { vinNo: "NEW-VIN" },
  );
});
