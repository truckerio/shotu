import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./operational-workorders.repo.js", import.meta.url), "utf8");

test("administrative module updates persist diagnosis and repair with optimistic progress versioning", () => {
  assert.match(source, /before\.progress_version !== input\.expectedVersion/);
  assert.match(source, /diagnosis = case when \$9::boolean then \$10 else diagnosis end/);
  assert.match(source, /work_performed = case when \$11::boolean then \$12 else work_performed end/);
  assert.match(source, /progress_version = progress_version \+ case when \$9::boolean or \$11::boolean or \$13::boolean then 1 else 0 end/);
});

test("administrative full-form saves preserve server-owned labor hours when the payload omits them", () => {
  assert.match(source, /function preserveMechanicOwnedFormData\([^)]*preserveLaborHours = false[^)]*\)[\s\S]*if \(preserveLaborHours\)[\s\S]*preserved\.laborHours = beforeFormData\.laborHours/);
  assert.match(source, /preserveMechanicOwnedFormData\([\s\S]*before\.form_data,[\s\S]*requestedFormData,[\s\S]*\{ preserveLaborHours: !laborHoursIncluded \}/);
});

test("creation promotes the labor-row repair order into canonical work performed", () => {
  assert.match(source, /insert into operational_workorders \([\s\S]*work_performed[\s\S]*values \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8::jsonb, \$9\)/);
  assert.match(source, /formData\.workPerformed \|\| ""/);
});
