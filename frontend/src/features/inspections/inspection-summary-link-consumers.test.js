import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const office = readFileSync(new URL("../office/OfficeWorkspace.jsx", import.meta.url), "utf8");
const mechanic = readFileSync(new URL("../mechanic/MechanicWorkspace.jsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../admin/workspace/OperationsPage.jsx", import.meta.url), "utf8");

test("Office and Admin pass their canonical open-workorder callbacks to inspection detail only with Workorders read access", () => {
  assert.match(office, /<InspectionExperience[\s\S]*onOpenWorkorder=\{workorderAccess\.canRead \? openDetail : null\}/);
  assert.match(admin, /<InspectionExperience[\s\S]*onOpenWorkorder=\{workorderAccess\.canRead \? onOpenWorkorder : null\}/);
});

test("Mechanic inspection links use its local workorder loader and preserve inspection-only privacy", () => {
  assert.match(mechanic, /async function openWorkorder\(id, inspectionReturn\)/);
  assert.match(mechanic, /onOpenWorkorder\(detail, \{ inspectionReturn \}\)/);
  assert.match(mechanic, /<InspectionExperience[\s\S]*onOpenWorkorder=\{workorderAccess\.canRead \? openWorkorder : null\}/);
  assert.doesNotMatch(mechanic, /onOpenWorkorder=\{workorderAccess\.canRead \? onOpenWorkorder : null\}/);
});
