import assert from "node:assert/strict";
import test from "node:test";

import { canReadArchiveJob, safeArchiveJob, safeArchiveShare, scopeArchiveLedger } from "./archive-scope.js";

const context = {
  actor: { role: "office" },
  companyIds: new Set(["company-a"]),
  locationIds: new Set(["location-a"]),
};

test("archive state is company and location scoped", () => {
  const scoped = scopeArchiveLedger({
    companies: {
      "company-a": { issued: [{ serial: "WO-A", jobId: "job-a" }, { serial: "WO-B", jobId: "job-b" }] },
      "company-b": { issued: [{ serial: "WO-C", jobId: "job-c" }] },
    },
    workorders: {
      "WO-A": { companyId: "company-a", jobIds: ["job-a"] },
      "WO-B": { companyId: "company-a", jobIds: ["job-b"] },
      "WO-C": { companyId: "company-b", jobIds: ["job-c"] },
    },
    jobs: [
      { id: "job-a", companyId: "company-a", locationId: "location-a", serials: ["WO-A"] },
      { id: "job-b", companyId: "company-a", locationId: "location-b", serials: ["WO-B"] },
      { id: "job-c", companyId: "company-b", locationId: "location-a", serials: ["WO-C"] },
    ],
    shares: [],
    activity: [],
  }, context);

  assert.deepEqual(scoped.jobs.map((job) => job.id), ["job-a"]);
  assert.deepEqual(Object.keys(scoped.workorders), ["WO-A"]);
  assert.deepEqual(scoped.companies["company-a"].issued.map((entry) => entry.serial), ["WO-A"]);
  assert.equal(canReadArchiveJob({ ...context, locationIds: new Set() }, scoped.jobs[0]), false);
});

test("archive API projections redact server storage paths", () => {
  assert.deepEqual(safeArchiveJob({ id: "job-a", pdfPath: "/secret/file.pdf" }), { id: "job-a" });
  assert.deepEqual(safeArchiveShare({ id: "share-a", packagePath: "/secret/share" }), { id: "share-a" });
});
