import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  uniqueKnownValues,
  workorderMobileMeta,
  workorderOpenLabel,
} from "./workorder-queue-config.js";

test("queue CSS keeps phone targets and overflow contained", async () => {
  const css = await readFile(new URL("../workorders/workorder-queue.css", import.meta.url), "utf8");
  const mobileRules = css.slice(css.indexOf("@media (max-width: 700px)"));
  assert.match(mobileRules, /\.mechanic-queue-tabs button\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(mobileRules, /\.accept-work-button\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(mobileRules, /\.mechanic-work-row\s*\{[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;/s);
});

test("mobile metadata removes missing and duplicate values", () => {
  assert.deepEqual(
    uniqueKnownValues(["Sacramento", "Sacramento", "Unassigned", "Location not set"]),
    ["Sacramento"],
  );
  assert.equal(workorderMobileMeta({ location: "Sacramento", mechanic: "Alex" }), "Sacramento · Alex");
});

test("open label carries context hidden by compact layout", () => {
  assert.equal(
    workorderOpenLabel({ serial: "WO-1042", unit: "Truck 88", concern: "Air leak" }),
    "Open workorder WO-1042 for Truck 88: Air leak",
  );
});
