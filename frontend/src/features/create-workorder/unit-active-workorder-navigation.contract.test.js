import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const router = readFileSync(new URL("../../app/routes/RoleRouter.jsx", import.meta.url), "utf8");
const detailRoute = readFileSync(new URL("../../app/routes/useWorkorderDetailRoute.js", import.meta.url), "utf8");
const page = readFileSync(new URL("./CreateWorkorderPage.jsx", import.meta.url), "utf8");
const form = readFileSync(new URL("../generator/CreateWorkorderForm.jsx", import.meta.url), "utf8");

test("active unit results open authorized existing workorders through the create prop chain", () => {
  assert.match(detailRoute, /const openActiveUnitWorkorder = useCallback\(async \(workorderId\) =>/);
  assert.match(detailRoute, /loadWorkorderDetail\(\{ markOpened: true, role: actor\.role, workorderId \}\)/);
  assert.match(detailRoute, /actor\.role === "mechanic"\) hydrateOperationalWorkorder\(detail\)/);
  assert.match(detailRoute, /else hydrateOfficeWorkorder\(detail\)/);
  assert.match(router, /setCreateState: setOfficeCreateState/);
  assert.match(router, /openActiveUnitWorkorder, openFullscreenPreview/);
  assert.match(page, /onOpenActiveWorkorder=\{openActiveUnitWorkorder\}/);
  assert.match(form, /onOpenActiveWorkorder/);
  assert.match(form, /unit: \{[\s\S]*onOpenActiveWorkorder,[\s\S]*onVehicleSelect/);
});
