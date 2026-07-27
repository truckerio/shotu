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
  const result = await identifyMechanicChatPart({
    message: "Need LF9009",
    workorderContext,
  }, {
    config: { openAiApiKey: "configured" },
    findTruckContext: async () => ({ family: "cascadia", matched: true }),
    identifyWithOpenAI: async () => ({
      result: {
        status: "matched",
        normalizedPartNumber: "LF9009",
        description: "Engine oil filter",
      },
      sources: [{ url: "https://example.com/lf9009" }],
      consultedSourceCount: 1,
    }),
  });

  assert.equal(result.part.normalizedPartNumber, "LF9009");
  assert.equal(result.vehicle.unitNo, "G2021");
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
