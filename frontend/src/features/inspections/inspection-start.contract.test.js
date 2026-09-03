import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectionStartPayload } from "./inspection-api-model.js";

const detail = readFileSync(new URL("./InspectionDetail.jsx", import.meta.url), "utf8");
const experience = readFileSync(new URL("./InspectionExperience.jsx", import.meta.url), "utf8");

test("opening assigned work never auto-starts and routes the explicit start command through the durable API", () => {
  assert.doesNotMatch(experience, /status === "assigned"\)\s*\{\s*result = await api\(`\/api\/inspections\/\$\{encodeURIComponent\(record\.id\)\}\/actions\/start/);
  assert.match(experience, /async function startInspection\(input\)/);
  assert.match(experience, /\/actions\/start/);
  assert.match(experience, /onStart=\{activeInspectionAccess\.canWrite/);
});

test("start form keeps truck requirements separate from trailer and focuses the first checklist response after success", () => {
  assert.match(detail, /Start inspection/);
  assert.match(detail, /Odometer/);
  assert.match(detail, /Engine hours/);
  assert.match(detail, /Previous report reviewed/);
  assert.match(detail, /isTrailer/);
  assert.match(detail, /startFirstIncomplete/);
  assert.match(detail, /Location/);
  assert.match(detail, /inspection-start/);
  assert.match(readFileSync(new URL("./inspections.css", import.meta.url), "utf8"), /\.inspection-start input \{ min-height: 44px; \}/);
});

test("start payload always sends required review evidence and only applicable measured fields", () => {
  assert.deepEqual(
    inspectionStartPayload({ version: 3, unitType: "Truck", previousReportAvailable: true }, { odometerMiles: "124500", engineHours: "2500.5", previousReportReviewed: true }),
    { expectedVersion: 3, odometerMiles: 124500, engineHours: 2500.5, previousReportReviewed: true },
  );
  assert.deepEqual(
    inspectionStartPayload({ version: 4, unitType: "Trailer", previousReportAvailable: false }, { odometerMiles: "999", engineHours: "10", previousReportReviewed: false }),
    { expectedVersion: 4, previousReportReviewed: false },
  );
  assert.deepEqual(inspectionStartPayload({version:5,unitType:"Truck",previousReportAvailable:false},{odometerMiles:"42",previousReportReviewed:false}),{expectedVersion:5,odometerMiles:42,previousReportReviewed:false});
});
