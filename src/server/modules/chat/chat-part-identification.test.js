import assert from "node:assert/strict";
import test from "node:test";
import { identifyMechanicChatPart } from "./chat-part-identification.service.js";

const workorderContext = {
  asset_id: "asset-1",
  unit_no: "G2021",
  make: "Freightliner",
  model: "Cascadia",
  year: 2022,
  vin: "1FUJHHDR0NLAA0001",
  raw_provider_data: { engine: { name: "Detroit DD15" } },
};

test("mechanic chat identification no longer depends on a feature flag", async () => {
  let receivedOptions;
  const result = await identifyMechanicChatPart({
    message: "Need LF9009",
    workorderContext,
  }, {
    config: { openAiApiKey: "configured" },
    findTruckContext: async () => ({ family: "cascadia", matched: true }),
    identifyWithOpenAI: async (_input, _truckContext, options) => {
      receivedOptions = options;
      return {
      result: {
        status: "matched",
        normalizedPartNumber: "LF9009",
        description: "Engine oil filter",
      },
      sources: [{ url: "https://example.com/lf9009" }],
      consultedSourceCount: 1,
      };
    },
  });

  assert.equal(result.part.normalizedPartNumber, "LF9009");
  assert.equal(result.vehicle.unitNo, "G2021");
  assert.equal(receivedOptions.timeoutMs, 8_000);
});

test("company-approved part data resolves before AI", async () => {
  let aiCalled = false;
  const result = await identifyMechanicChatPart({
    message: "Need LF9009",
    partNumber: "LF9009",
    partDescription: "LF9009",
    workorderContext: { ...workorderContext, company_id: "company-1" },
  }, {
    findCatalogPart: async () => ({
      partNumber: "LF9009",
      manufacturer: "Fleetguard",
      description: "Engine oil filter",
      category: "lube_filter",
      repairOrder: "Replace engine oil filter and check for leaks.",
    }),
    identifyWithOpenAI: async () => {
      aiCalled = true;
      throw new Error("AI must not run");
    },
  });

  assert.equal(result.resolutionSource, "company_catalog");
  assert.equal(result.part.normalizedPartNumber, "LF9009");
  assert.equal(result.part.description, "Engine oil filter");
  assert.equal(aiCalled, false);
});

test("unknown mechanic part number is preserved immediately without AI", async () => {
  let aiCalled = false;
  const result = await identifyMechanicChatPart({
    message: "Need ZX-9911",
    partNumber: "ZX-9911",
    partDescription: "ZX-9911",
    workorderContext: { ...workorderContext, company_id: "company-1" },
  }, {
    findCatalogPart: async () => null,
    identifyWithOpenAI: async () => {
      aiCalled = true;
      throw new Error("AI must not run");
    },
  });

  assert.equal(result.resolutionSource, "mechanic_input");
  assert.equal(result.part.normalizedPartNumber, "ZX-9911");
  assert.equal(result.part.status, "ambiguous");
  assert.equal(aiCalled, false);
});

test("mechanic chat identification fails closed without provider credentials", async () => {
  await assert.rejects(
    () => identifyMechanicChatPart({
      message: "Need LF9009",
      workorderContext,
    }, {
      config: { openAiApiKey: "" },
    }),
    (error) => error.code === "PARTS_HELPER_UNAVAILABLE",
  );
});
