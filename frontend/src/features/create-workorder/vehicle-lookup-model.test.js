import assert from "node:assert/strict";
import test from "node:test";

import {
  vehicleBelongsToCompany,
  vehicleCompanyId,
  vehiclesForCompany,
} from "./vehicle-lookup-model.js";

test("vehicle company matching supports database and public field names", () => {
  assert.equal(vehicleCompanyId({ company_id: "company-a" }), "company-a");
  assert.equal(vehicleCompanyId({ companyId: "company-b" }), "company-b");
  assert.equal(vehicleBelongsToCompany({ company_id: "company-a" }, "company-a"), true);
  assert.equal(vehicleBelongsToCompany({ company_id: "company-b" }, "company-a"), false);
});

test("vehicle suggestions stay inside the selected repair-location company", () => {
  const vehicles = [
    { id: "asset-a", company_id: "company-a" },
    { id: "asset-b", company_id: "company-b" },
  ];
  assert.deepEqual(vehiclesForCompany(vehicles, "company-b"), [vehicles[1]]);
  assert.deepEqual(vehiclesForCompany(vehicles, ""), vehicles);
});
