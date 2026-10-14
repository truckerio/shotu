import assert from "node:assert/strict";
import test from "node:test";
import { loadInspectionPrintableArchive } from "./inspection-print-loader.js";

const inspection = { id: "inspection-1", version: 7 };
test("printing pending or ready completion evidence never competes for an archive lease", async () => {
  for (const status of ["pending", "ready"]) {
    const calls = [];
    const expected = { archive: { id: "archive-1", status }, html: "frozen slip" };
    const result = await loadInspectionPrintableArchive({ inspection, canWrite: true, request: async (url, options) => { calls.push([url, options]); return expected; } });
    assert.equal(result, expected);
    assert.deepEqual(calls, [["/api/inspections/inspection-1/print", undefined]]);
  }
});
test("only a writer with genuinely missing evidence may create an archive", async () => {
  const calls = [];
  const result = await loadInspectionPrintableArchive({ inspection, canWrite: true, request: async (url, options) => {
    calls.push([url, options]);
    if (calls.length === 1) throw Object.assign(new Error("Missing archive"), { code: "INSPECTION_PRINT_ARCHIVE_UNAVAILABLE" });
    return calls.length === 2 ? { archive: { id: "archive-1" } } : { html: "created slip" };
  } });
  assert.equal(result.html, "created slip");
  assert.equal(calls[1][1].method, "POST");
  assert.equal(calls[2][0], "/api/inspections/inspection-1/print-archives/archive-1");
});
test("printing does not mask integrity, permission, or read-only missing-evidence errors", async () => {
  for (const [canWrite, code] of [[true, "INSPECTION_PRINT_ARCHIVE_INTEGRITY_FAILURE"], [true, "FORBIDDEN"], [false, "INSPECTION_PRINT_ARCHIVE_UNAVAILABLE"]]) {
    let calls = 0;
    const error = Object.assign(new Error(code), { code });
    await assert.rejects(loadInspectionPrintableArchive({ inspection, canWrite, request: async () => { calls++; throw error; } }), e => e === error);
    assert.equal(calls, 1);
  }
});
