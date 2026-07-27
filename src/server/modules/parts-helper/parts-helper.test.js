import assert from "node:assert/strict";
import test from "node:test";
import { partsHelperEnabled } from "./parts-helper.config.js";
import { findLivePartPrices, identifyPart, resolveOfficePartRequest } from "./parts-helper.service.js";
import { requireSupportedTruck, supportedTruckFamily, UnsupportedTruckError } from "./supported-trucks.js";
import { identifyPartWithOpenAI, PartsHelperProviderError } from "./providers/openai.provider.js";

test("parts helper flag accepts normalized deployment values", () => {
  assert.equal(partsHelperEnabled("true"), true);
  assert.equal(partsHelperEnabled(" TRUE "), true);
  assert.equal(partsHelperEnabled(true), true);
  assert.equal(partsHelperEnabled("false"), false);
  assert.equal(partsHelperEnabled(undefined), false);
});

test("supported truck scope stays narrow", () => {
  assert.equal(supportedTruckFamily({ make: "Volvo", model: "VNL" }), "volvo");
  assert.equal(supportedTruckFamily({ make: "Peterbilt", model: "579" }), "peterbilt");
  assert.equal(supportedTruckFamily({ make: "Freightliner", model: "Cascadia" }), "cascadia");
  assert.equal(supportedTruckFamily({ make: "Freightliner", model: "M2 106" }), null);
  assert.throws(() => requireSupportedTruck({ make: "Kenworth", model: "T680" }), UnsupportedTruckError);
});

test("identification combines truck context and sourced OpenAI result", async () => {
  const result = await identifyPart({
    query: "LF9009",
    vehicle: { make: "Freightliner", model: "Cascadia", year: 2022, engine: "Detroit DD15" },
  }, {
    findTruckContext: async () => ({ provider: "huggingface", family: "cascadia", matched: true, vehicle: { engines: ["Detroit DD15"] } }),
    identifyWithOpenAI: async (_input, truckContext) => {
      assert.deepEqual(truckContext.vehicle.engines, ["Detroit DD15"]);
      return {
        result: {
          status: "matched",
          normalizedPartNumber: "LF9009",
          manufacturer: "Fleetguard",
          description: "Engine oil filter",
          category: "engine_oil_filter",
          suggestedQuantity: 1,
          repairOrder: "Replace engine oil filter and inspect for leaks.",
          fitmentStatus: "possible",
          confidence: 82,
          evidenceSummary: "Part identity supported; exact VIN fitment not proven.",
          cautions: ["Confirm fitment before installation."],
          alternatives: [],
        },
        sources: [{ url: "https://vendor.example/lf9009", title: "LF9009" }],
      };
    },
  });

  assert.equal(result.family, "cascadia");
  assert.equal(result.part.description, "Engine oil filter");
  assert.equal(result.part.fitmentStatus, "possible");
});

test("live pricing keeps source-backed listings and separates conditions", async () => {
  const result = await findLivePartPrices({
    partNumber: "LF9009",
    manufacturer: "Fleetguard",
    description: "Engine oil filter",
    quantity: 1,
    vehicle: { make: "Peterbilt", model: "579", year: 2021, engine: "Cummins X15" },
    location: { country: "US", city: "Chino", region: "CA", postalCode: "91710" },
  }, {
    findTruckContext: async () => ({ provider: "huggingface", family: "peterbilt", matched: true, vehicle: { model: "579" } }),
    findPricesWithOpenAI: async () => ({
      result: {
        status: "found",
        currency: "USD",
        cautions: [],
        listings: [
          { vendor: "A", title: "New filter", condition: "new", itemPrice: 40, shippingPrice: 5, availability: "In stock", pickup: "", fitmentStatus: "possible", fitmentClaim: "Verify", url: "https://a.example/products/lf9009" },
          { vendor: "B", title: "New filter", condition: "new", itemPrice: 50, shippingPrice: 0, availability: "In stock", pickup: "Today", fitmentStatus: "possible", fitmentClaim: "Verify", url: "https://b.example/lf9009" },
          { vendor: "Unsupported", title: "Unverified", condition: "used", itemPrice: 10, shippingPrice: 0, availability: "Unknown", pickup: "", fitmentStatus: "unknown", fitmentClaim: "Unknown", url: "https://bad.example/item" },
        ],
      },
      sources: [
        { url: "https://a.example/products/lf9009", title: "A" },
        { url: "https://b.example/lf9009", title: "B" },
      ],
    }),
  });

  assert.equal(result.listings.length, 2);
  assert.equal(result.excludedListings, 1);
  assert.equal(result.itemPriceComparisonByCondition.new.lowest, 40);
  assert.equal(result.itemPriceComparisonByCondition.new.average, 45);
  assert.equal(result.itemPriceComparisonByCondition.new.median, 45);
  assert.equal(result.landedPriceComparisonByCondition.new.lowest, 45);
  assert.equal(result.itemPriceComparisonByCondition.used, undefined);
});

test("OpenAI provider requires live web search and structured output", async () => {
  let requestBody;
  const fetchFn = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          { type: "web_search_call", action: { sources: [{ url: "https://vendor.example/lf9009", title: "Vendor" }] } },
          {
            type: "message",
            content: [{
              type: "output_text",
              text: JSON.stringify({
                status: "matched",
                normalizedPartNumber: "LF9009",
                manufacturer: "Fleetguard",
                description: "Engine oil filter",
                category: "engine_oil_filter",
                suggestedQuantity: 1,
                repairOrder: "Replace engine oil filter and inspect for leaks.",
                fitmentStatus: "possible",
                confidence: 80,
                evidenceSummary: "Part identity supported.",
                cautions: ["Confirm VIN fitment."],
                alternatives: [],
              }),
              annotations: [],
            }],
          },
        ],
      }),
    };
  };

  const response = await identifyPartWithOpenAI({
    query: "LF9009",
    vehicle: { make: "Freightliner", model: "Cascadia", engine: "Detroit DD15" },
  }, { family: "cascadia", matched: true }, {
    fetchFn,
    config: {
      openAiApiKey: "test-key",
      openAiModel: "gpt-5.6-sol",
      openAiBaseUrl: "https://api.openai.test/v1",
    },
  });

  assert.equal(response.result.normalizedPartNumber, "LF9009");
  assert.equal(response.sources.length, 1);
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.tool_choice, "required");
  assert.equal(requestBody.tools[0].type, "web_search");
  assert.equal(requestBody.tools[0].external_web_access, true);
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.equal(requestBody.text.format.strict, true);
});

test("OpenAI provider fails closed without server key", async () => {
  await assert.rejects(
    () => identifyPartWithOpenAI({ query: "LF9009", vehicle: { make: "Freightliner", model: "Cascadia" } }, {}, {
      config: { openAiApiKey: "", openAiModel: "gpt-5.6-sol", openAiBaseUrl: "https://api.openai.com/v1" },
    }),
    (error) => error instanceof PartsHelperProviderError && error.statusCode === 503,
  );
});

test("office photo flow identifies part before requesting prices", async () => {
  let priceInput;
  const result = await resolveOfficePartRequest({
    message: "Need same oil filter",
    imageUrl: "https://images.example/wix-51748xd.jpg",
    vehicle: { make: "Peterbilt", model: "579", year: 2021, engine: "Cummins X15" },
    location: { country: "US", city: "Chino", region: "CA", postalCode: "91710" },
  }, {
    findTruckContext: async () => ({ provider: "huggingface", family: "peterbilt", matched: true, vehicle: { engines: ["Cummins X15"] } }),
    identifyOfficeWithOpenAI: async () => ({
      result: {
        status: "matched",
        normalizedPartNumber: "51748XD",
        manufacturer: "WIX",
        description: "Extended-drain lube filter",
        category: "engine_oil_filter",
        suggestedQuantity: 1,
        repairOrder: "Replace engine oil filter and inspect for leaks.",
        fitmentStatus: "confirmed",
        confidence: 91,
        evidenceSummary: "Visible label identifies WIX 51748XD.",
        cautions: ["Confirm engine serial fitment."],
        alternatives: [],
      },
      sources: [{ url: "https://wixfilters.com/51748xd", title: "WIX 51748XD" }],
      consultedSourceCount: 3,
    }),
    findPricesWithOpenAI: async (input) => {
      priceInput = input;
      return {
        result: {
          status: "found",
          currency: "USD",
          cautions: [],
          listings: [{ vendor: "Vendor", title: "WIX 51748XD", condition: "new", itemPrice: 59, shippingPrice: 0, availability: "In stock", pickup: "Today", fitmentStatus: "possible", fitmentClaim: "Verify", url: "https://vendor.example/51748xd" }],
        },
        sources: [{ url: "https://vendor.example/51748xd", title: "Vendor" }],
        consultedSourceCount: 1,
      };
    },
  });

  assert.equal(priceInput.partNumber, "51748XD");
  assert.equal(result.part.description, "Extended-drain lube filter");
  assert.equal(result.pricing.listings[0].itemPrice, 59);
  assert.match(result.nextAction, /Confirm VIN/);
});

test("office flow stops pricing when photo identification is ambiguous", async () => {
  let priceCalled = false;
  const result = await resolveOfficePartRequest({
    message: "Need this sensor",
    imageUrl: "https://images.example/blurred-sensor.jpg",
    vehicle: { make: "Volvo", model: "VNL", year: 2020 },
    location: { country: "US", city: "Chino", region: "CA" },
  }, {
    findTruckContext: async () => ({ provider: "huggingface", family: "volvo", matched: true, vehicle: { model: "VNL" } }),
    identifyOfficeWithOpenAI: async () => ({
      result: {
        status: "ambiguous",
        normalizedPartNumber: "",
        manufacturer: "",
        description: "Possible sensor",
        category: "sensor",
        suggestedQuantity: 1,
        repairOrder: "Inspect sensor and connector.",
        fitmentStatus: "unknown",
        confidence: 35,
        evidenceSummary: "Label unreadable.",
        cautions: ["Clear label photo required."],
        alternatives: [],
      },
      sources: [],
      consultedSourceCount: 0,
    }),
    findPricesWithOpenAI: async () => { priceCalled = true; },
  });

  assert.equal(priceCalled, false);
  assert.equal(result.pricing, null);
  assert.match(result.nextAction, /clear label photo/);
});

test("office flow asks for fitment verification when an ambiguous candidate number exists", async () => {
  let priceCalled = false;
  const result = await resolveOfficePartRequest({
    message: "A4721800309",
    vehicle: { make: "Freightliner", model: "Cascadia", year: 2020, engine: "Detroit DD15" },
    location: { country: "US", city: "Chino", region: "CA" },
  }, {
    findTruckContext: async () => ({ provider: "huggingface", family: "cascadia", matched: true, vehicle: { model: "Cascadia" } }),
    identifyOfficeWithOpenAI: async () => ({
      result: {
        status: "ambiguous",
        normalizedPartNumber: "A4721800309",
        manufacturer: "Detroit Diesel",
        description: "Engine oil filter service kit",
        category: "engine_oil_filter",
        suggestedQuantity: 1,
        repairOrder: "Verify the filter kit by engine serial number.",
        fitmentStatus: "unknown",
        confidence: 82,
        evidenceSummary: "Part identity found; exact replacement not proven.",
        cautions: ["Engine serial verification required."],
        alternatives: [],
      },
      sources: [{ url: "https://example.com/a4721800309", title: "Candidate" }],
      consultedSourceCount: 1,
    }),
    findPricesWithOpenAI: async () => { priceCalled = true; },
  });

  assert.equal(priceCalled, false);
  assert.equal(result.pricing, null);
  assert.match(result.nextAction, /Verify the candidate part number/);
});
