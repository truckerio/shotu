import assert from "node:assert/strict";
import test from "node:test";
import { resolveMechanicProgressFields } from "./mechanic-progress-fields.js";

test("persisted empty mechanic fields override stale formData values", () => {
  assert.deepEqual(
    resolveMechanicProgressFields(
      { diagnosis: "", workPerformed: "" },
      { diagnosis: "Old diagnosis", workPerformed: "Old repair" },
    ),
    { diagnosis: "", workPerformed: "" },
  );
});

test("legacy records without progress fields can still use saved formData", () => {
  assert.deepEqual(
    resolveMechanicProgressFields(
      {},
      { diagnosis: "Legacy diagnosis", workPerformed: "Legacy repair" },
    ),
    { diagnosis: "Legacy diagnosis", workPerformed: "Legacy repair" },
  );
});
