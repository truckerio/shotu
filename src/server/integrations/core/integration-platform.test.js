import assert from "node:assert/strict";
import test from "node:test";
import { integrationRetryDelaySeconds } from "./integration-jobs.js";
import {
  clearIntegrationProvidersForTest,
  getIntegrationJobHandler,
  getIntegrationProvider,
  listIntegrationProviders,
  registerIntegrationProvider,
} from "./integration-provider.registry.js";

test("provider registry keeps capabilities and jobs behind one adapter contract", async () => {
  clearIntegrationProvidersForTest();
  const handled = [];
  registerIntegrationProvider({
    provider: "test-provider",
    capabilities: ["sync"],
    jobs: {
      sync: async (job) => handled.push(job.id),
    },
  });
  assert.equal(getIntegrationProvider("test-provider").provider, "test-provider");
  assert.deepEqual(listIntegrationProviders(), [{
    provider: "test-provider",
    capabilities: ["sync"],
  }]);
  await getIntegrationJobHandler("test-provider", "sync")({ id: "job-1" });
  assert.deepEqual(handled, ["job-1"]);
  assert.throws(
    () => registerIntegrationProvider({ provider: "test-provider" }),
    /already registered/,
  );
});

test("durable job retries use bounded exponential backoff", () => {
  assert.equal(integrationRetryDelaySeconds(1), 15);
  assert.equal(integrationRetryDelaySeconds(2), 30);
  assert.equal(integrationRetryDelaySeconds(10), 3600);
});
