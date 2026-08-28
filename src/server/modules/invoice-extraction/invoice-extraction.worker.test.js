import assert from "node:assert/strict";
import test from "node:test";
import { InvoiceExtractionError } from "./invoice-extraction.errors.js";
import { processInvoiceExtractionJob } from "./invoice-extraction.worker.js";

const RUN_ID = "44444444-4444-4444-8444-444444444444";
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const DEFAULT_COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";

function job(overrides = {}) {
  return {
    company_id: COMPANY_ID,
    payload: { runId: RUN_ID, vendorHint: "FleetPride" },
    attempts: 1,
    max_attempts: 2,
    ...overrides,
  };
}

function source() {
  return {
    company_id: COMPANY_ID,
    run_id: RUN_ID,
    location_id: LOCATION_ID,
    file_name: "invoice.png",
    mime_type: "image/png",
    byte_size: 4,
    content_sha256: "a".repeat(64),
  };
}

test("worker derives tenant and document only from the durable job/source", async () => {
  let executeInput;
  const result = await processInvoiceExtractionJob(job(), {
    getSource: async (input) => {
      assert.deepEqual(input, { runId: RUN_ID, companyId: COMPANY_ID });
      return source();
    },
    decryptDocument: () => Buffer.from("safe"),
    loadMemory: async (input) => {
      assert.equal(input.companyId, COMPANY_ID);
      return { semanticFacts: [], playbooks: [], trainingExamples: [] };
    },
    loadTemplates: async (input) => {
      assert.equal(input.companyId, COMPANY_ID);
      return [];
    },
    execute: async (input, options) => {
      executeInput = input;
      assert.equal(options.deferFailure, true);
      return { run: { id: RUN_ID, status: "completed" } };
    },
  });
  assert.equal(result.run.status, "completed");
  assert.equal(executeInput.location.company_id, COMPANY_ID);
  assert.equal(executeInput.parsed.dataUrl, `data:image/png;base64,${Buffer.from("safe").toString("base64")}`);
});

test("worker accepts the seeded local company UUID", async () => {
  let sourceInput;
  const result = await processInvoiceExtractionJob(job({ company_id: DEFAULT_COMPANY_ID }), {
    getSource: async (input) => {
      sourceInput = input;
      return { ...source(), company_id: DEFAULT_COMPANY_ID };
    },
    decryptDocument: () => Buffer.from("safe"),
    loadMemory: async () => ({ semanticFacts: [], playbooks: [], trainingExamples: [] }),
    loadTemplates: async () => [],
    execute: async () => ({ run: { id: RUN_ID, status: "completed" } }),
  });
  assert.deepEqual(sourceInput, { runId: RUN_ID, companyId: DEFAULT_COMPANY_ID });
  assert.equal(result.run.status, "completed");
});

test("worker retries retryable errors and marks the run failed on the final attempt", async () => {
  const retryable = new InvoiceExtractionError("Provider timed out.", {
    code: "provider_timeout",
    statusCode: 503,
    retryable: true,
  });
  const dependencies = {
    getSource: async () => source(),
    decryptDocument: () => Buffer.from("safe"),
    loadMemory: async () => ({ semanticFacts: [], playbooks: [], trainingExamples: [] }),
    loadTemplates: async () => [],
    execute: async () => { throw retryable; },
  };
  await assert.rejects(() => processInvoiceExtractionJob(job(), dependencies), (error) => error.code === "provider_timeout");
  let failed;
  await assert.rejects(() => processInvoiceExtractionJob(job({ attempts: 2 }), {
    ...dependencies,
    failRun: async (input) => { failed = input; },
  }), (error) => error.code === "provider_timeout" && error.terminal === true);
  assert.equal(failed.companyId, COMPANY_ID);
  assert.equal(failed.errorCode, "provider_timeout");
});

test("worker rejects malformed tenant/job identifiers before decrypting", async () => {
  let accessed = false;
  await assert.rejects(() => processInvoiceExtractionJob(job({ company_id: "not-a-company" }), {
    getSource: async () => { accessed = true; },
  }), (error) => error.code === "invoice_job_invalid" && error.retryable === false);
  assert.equal(accessed, false);
});
