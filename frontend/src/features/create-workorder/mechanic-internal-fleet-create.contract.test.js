import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { interfaceText } from "../../i18n/index.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const commands = source("../../app/routes/useRoleRouterCommands.js");
const form = source("../generator/CreateWorkorderForm.jsx");
const unit = source("../workorder-modules/unit/CreateUnitModule.jsx");
const page = source("./CreateWorkorderPage.jsx");
const vehicle = source("./useVehicleLookupController.js");

test("mechanic customer guidance and field requirement follow role through Create modules", () => {
  assert.match(page, /actorRole=\{actor\.role\}/);
  assert.match(form, /unit: \{[^\n]*actorRole, customerControl/);
  assert.match(unit, /required=\{actorRole !== "mechanic"\}/);
  assert.match(unit, /hint=\{actorRole === "mechanic" \? t\("create\.mechanicCustomerGuidance"\)/);
  for (const locale of ["en", "es", "pa"]) {
    assert.match(interfaceText(locale, "create.mechanicCustomerGuidance"), /./);
    assert.match(interfaceText(locale, "create.validation.mechanicCustomerCompanyName"), /./);
  }
});

test("mechanic validation runs before submit and preserves an autofilled owner for correction", () => {
  assert.match(commands, /validateCreateWorkorder\(form, \{ actorRole: actor\.role \}\)/);
  assert.match(commands, /if \(Object\.keys\(errors\)\.length\)[\s\S]*?setCreateErrors\(errors\)[\s\S]*?return;[\s\S]*?api\(customerIntake/);
  assert.match(vehicle, /customerCompanyName: vehicle\.owner_name \|\| currentForm\.customerCompanyName/);
  assert.match(page, /officeCreateState\.code === "CUSTOMER_ESTIMATE_ACCEPTANCE_REQUIRED"/);
  assert.match(page, /showApprovalControl=\{!isMechanicCreate\}/);
});
