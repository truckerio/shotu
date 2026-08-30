import assert from "node:assert/strict";
import test from "node:test";
import {
  findLivePartPrices,
  getPartRepairSuggestions,
  identifyPart,
  resolveOfficePartRequest,
  searchPartCatalog,
} from "./parts-helper.service.js";
import {
  catalogSearchInputSchema,
  identifyPartResultSchema,
  repairSuggestionsInputSchema,
} from "./parts-helper.schemas.js";
import { handlePartsHelperApi } from "./parts-helper.routes.js";
import { requireSupportedTruck, supportedTruckFamily, UnsupportedTruckError } from "./supported-trucks.js";
import { identifyPartWithOpenAI, PartsHelperProviderError } from "./providers/openai.provider.js";

test("AI quantity suggestions respect the selected unit", () => {
  const baseResult = {
    status: "matched",
    normalizedPartNumber: "TEST",
    manufacturer: "Test",
    description: "Test part",
    category: "test",
    repairOrder: "Install test part.",
    fitmentStatus: "possible",
    confidence: 80,
    evidenceSummary: "Test result.",
    cautions: [],
    alternatives: [],
  };

  assert.equal(identifyPartResultSchema.safeParse({
    ...baseResult,
    suggestedQuantity: 1.5,
    uomCode: "ea",
  }).success, false);
  assert.equal(identifyPartResultSchema.safeParse({
    ...baseResult,
    suggestedQuantity: 1.5,
    uomCode: "gal",
  }).success, true);
});

test("catalog search input requires one authorized scope and a bounded query", () => {
  const workorderId = "11111111-1111-4111-8111-111111111111";
  const locationId = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(catalogSearchInputSchema.parse({ workorderId, q: "  LF9  " }), {
    workorderId,
    purpose: "request",
    q: "LF9",
    limit: 8,
  });
  assert.equal(catalogSearchInputSchema.parse({ workorderId, purpose: "issue", q: "filter" }).purpose, "issue");
  assert.equal(catalogSearchInputSchema.parse({ workorderId, purpose: "master_match", q: "filter" }).purpose, "master_match");
  assert.equal(catalogSearchInputSchema.safeParse({ workorderId, purpose: "all", q: "filter" }).success, false);
  assert.equal(catalogSearchInputSchema.safeParse({ workorderId, q: "x" }).success, false);
  assert.equal(catalogSearchInputSchema.safeParse({ workorderId, q: "filter", limit: 13 }).success, false);
  assert.equal(catalogSearchInputSchema.parse({ locationId, q: "filter" }).locationId, locationId);
  assert.equal(catalogSearchInputSchema.safeParse({ q: "filter" }).success, false);
  assert.equal(catalogSearchInputSchema.safeParse({ workorderId, locationId, q: "filter" }).success, false);
});

test("catalog search derives company and location from authorized workorder", async () => {
  const calls = [];
  const requestContext = { actor: { id: "office-1", role: "office" } };
  const result = await searchPartCatalog({
    workorderId: "11111111-1111-4111-8111-111111111111",
    q: "  LF90 ",
    limit: "6",
    companyId: "attacker-company",
  }, requestContext, {
    requireWorkorderAccess: async (context, workorderId) => {
      calls.push({ type: "access", context, workorderId });
      return { companyId: "company-1", locationId: "location-1" };
    },
    searchCatalogParts: async (companyId, options) => {
      calls.push({ type: "search", companyId, options });
      return {
        catalogAvailable: true,
        items: [{ id: "part-1", source: "local", inventory: { locationId: "location-1", available: 0 } }],
      };
    },
  });

  assert.deepEqual(calls[0], {
    type: "access",
    context: requestContext,
    workorderId: "11111111-1111-4111-8111-111111111111",
  });
  assert.deepEqual(calls[1], {
    type: "search",
    companyId: "company-1",
    options: { text: "LF90", locationId: "location-1", limit: 6, purpose: "request" },
  });
  assert.deepEqual(result, {
    query: "LF90",
    catalogAvailable: true,
    items: [{ id: "part-1", source: "local", inventory: { locationId: "location-1", available: 0 } }],
  });
});

test("catalog search derives company from an authorized create-workorder location", async () => {
  const locationId = "22222222-2222-4222-8222-222222222222";
  const companyId = "33333333-3333-4333-8333-333333333333";
  const calls = [];
  const requestContext = {
    actor: { id: "office-1", role: "office" },
    companyIds: new Set([companyId]),
    locationIds: new Set([locationId]),
  };

  const result = await searchPartCatalog({ locationId, q: " oil " }, requestContext, {
    getLocationById: async (id, companyIds) => {
      calls.push({ type: "location", id, companyIds });
      return { id: locationId, company_id: companyId };
    },
    searchCatalogParts: async (scopedCompanyId, options) => {
      calls.push({ type: "search", companyId: scopedCompanyId, options });
      return {
        catalogAvailable: true,
        items: [{ id: "part-1", source: "local", inventory: { locationId, available: 0 } }],
      };
    },
  });

  assert.deepEqual(calls, [
    { type: "location", id: locationId, companyIds: [companyId] },
    { type: "search", companyId, options: { text: "oil", locationId, limit: 8, purpose: "request" } },
  ]);
  assert.equal(result.items[0].id, "part-1");
});

test("catalog search rejects a create-workorder location outside the actor scope", async () => {
  const locationId = "22222222-2222-4222-8222-222222222222";
  let searched = false;
  await assert.rejects(() => searchPartCatalog({ locationId, q: "oil" }, {
    actor: { id: "office-1", role: "office" },
    companyIds: new Set(["33333333-3333-4333-8333-333333333333"]),
    locationIds: new Set(),
  }, {
    getLocationById: async () => ({
      id: locationId,
      company_id: "33333333-3333-4333-8333-333333333333",
    }),
    searchCatalogParts: async () => {
      searched = true;
      return { catalogAvailable: true, items: [] };
    },
  }), (error) => error.statusCode === 403);
  assert.equal(searched, false);
});

test("catalog search stops before repository lookup when workorder access fails", async () => {
  const denied = Object.assign(new Error("Workorder not found."), { statusCode: 404 });
  let searched = false;

  await assert.rejects(
    () => searchPartCatalog({
      workorderId: "11111111-1111-4111-8111-111111111111",
      q: "LF90",
    }, { actor: { id: "office-1", role: "office" } }, {
      requireWorkorderAccess: async () => {
        throw denied;
      },
      searchCatalogParts: async () => {
        searched = true;
        return { catalogAvailable: true, items: [] };
      },
    }),
    (error) => error === denied,
  );
  assert.equal(searched, false);
});

test("operational catalog purposes return only local inventory in the authorized location", async () => {
  const localAvailable = {
    id: "local-available",
    source: "local",
    providerManaged: true,
    inventory: { locationId: "location-1", available: 3 },
  };
  const localZero = {
    id: "local-zero",
    source: "local",
    inventory: { locationId: "location-1", available: 0 },
  };
  const candidates = [
    { id: "odoo-only", source: "odoo", providerManaged: true, inventory: null },
    localAvailable,
    localZero,
    { id: "other-location", source: "local", inventory: { locationId: "location-2", available: 9 } },
  ];
  const dependencies = {
    requireWorkorderAccess: async () => ({ companyId: "company-1", locationId: "location-1" }),
    searchCatalogParts: async () => ({ catalogAvailable: true, items: candidates }),
  };
  const context = { actor: { id: "mechanic-1", role: "mechanic" } };
  const requestResult = await searchPartCatalog({
    workorderId: "11111111-1111-4111-8111-111111111111",
    purpose: "request",
    q: "filter",
  }, context, dependencies);
  const issueResult = await searchPartCatalog({
    workorderId: "11111111-1111-4111-8111-111111111111",
    purpose: "issue",
    q: "filter",
  }, context, dependencies);

  assert.deepEqual(requestResult.items, [localAvailable, localZero]);
  assert.deepEqual(issueResult.items, [localAvailable]);
  assert.equal(issueResult.items[0].source, "local");
  assert.equal(issueResult.items[0].providerManaged, true);
});

test("master-match catalog search requires inventory count apply permission", async () => {
  const calls = [];
  const catalogItems = [{ id: "odoo-only", source: "odoo", inventory: null }];
  const context = { actor: { id: "admin-1", role: "admin" } };
  const result = await searchPartCatalog({
    workorderId: "11111111-1111-4111-8111-111111111111",
    purpose: "master_match",
    q: "filter",
  }, context, {
    requireWorkorderAccess: async () => ({ companyId: "company-1", locationId: "location-1" }),
    requirePermission: (receivedContext, permission) => calls.push({ receivedContext, permission }),
    searchCatalogParts: async (companyId, options) => {
      calls.push({ companyId, options });
      return { catalogAvailable: true, items: catalogItems };
    },
  });

  assert.equal(calls[0].receivedContext, context);
  assert.equal(calls[0].permission, "inventory:count-apply");
  assert.deepEqual(calls[1], {
    companyId: "company-1",
    options: { text: "filter", locationId: "location-1", limit: 8, purpose: "master_match" },
  });
  assert.deepEqual(result.items, catalogItems);
});

test("master-match permission denial stops before catalog lookup", async () => {
  let searched = false;
  await assert.rejects(() => searchPartCatalog({
    workorderId: "11111111-1111-4111-8111-111111111111",
    purpose: "master_match",
    q: "filter",
  }, { actor: { id: "mechanic-1", role: "mechanic" } }, {
    requireWorkorderAccess: async () => ({ companyId: "company-1", locationId: "location-1" }),
    requirePermission: () => {
      throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    },
    searchCatalogParts: async () => {
      searched = true;
      return { catalogAvailable: true, items: [] };
    },
  }), (error) => error.statusCode === 403);
  assert.equal(searched, false);
});

test("catalog route forwards only URL search fields and request context", async () => {
  const requestContext = { actor: { id: "mechanic-1", role: "mechanic" } };
  const calls = [];
  const response = {};
  const handled = await handlePartsHelperApi(
    { method: "GET" },
    response,
    new URL("http://localhost/api/parts-helper/catalog?workorderId=11111111-1111-4111-8111-111111111111&q=oil%20filter&limit=4&purpose=issue&companyId=other"),
    {
      requestContext,
      sendJson: (res, status, body) => Object.assign(res, { status, body }),
      readBody: async () => ({}),
      partsHelperDependencies: {
        requireWorkorderAccess: async (context, workorderId) => {
          calls.push({ type: "access", context, workorderId });
          return { companyId: "company-1", locationId: "location-1" };
        },
        searchCatalogParts: async (companyId, options) => {
          calls.push({ type: "search", companyId, options });
          return { catalogAvailable: false, items: [] };
        },
      },
    },
  );

  assert.equal(handled, true);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { query: "oil filter", catalogAvailable: false, items: [] });
  assert.deepEqual(calls[1], {
    type: "search",
    companyId: "company-1",
    options: { text: "oil filter", locationId: "location-1", limit: 4, purpose: "issue" },
  });
});

test("catalog route supports authorized location scope before a workorder exists", async () => {
  const locationId = "22222222-2222-4222-8222-222222222222";
  const companyId = "33333333-3333-4333-8333-333333333333";
  const response = {};
  await handlePartsHelperApi(
    { method: "GET" },
    response,
    new URL(`http://localhost/api/parts-helper/catalog?locationId=${locationId}&q=oil`),
    {
      requestContext: {
        actor: { id: "office-1", role: "office" },
        companyIds: new Set([companyId]),
        locationIds: new Set([locationId]),
      },
      sendJson: (res, status, body) => Object.assign(res, { status, body }),
      readBody: async () => ({}),
      partsHelperDependencies: {
        getLocationById: async () => ({ id: locationId, company_id: companyId }),
        searchCatalogParts: async () => ({ catalogAvailable: true, items: [] }),
      },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { query: "oil", catalogAvailable: true, items: [] });
});

test("catalog route returns validation failures without searching", async () => {
  let searched = false;
  const response = {};
  await handlePartsHelperApi(
    { method: "GET" },
    response,
    new URL("http://localhost/api/parts-helper/catalog?workorderId=bad&q=x&companyId=other&locationId=other"),
    {
      requestContext: { actor: { id: "office-1", role: "office" } },
      sendJson: (res, status, body) => Object.assign(res, { status, body }),
      readBody: async () => ({}),
      partsHelperDependencies: {
        requireWorkorderAccess: async () => {
          throw new Error("must not resolve access for invalid input");
        },
        searchCatalogParts: async () => {
          searched = true;
          return { catalogAvailable: true, items: [] };
        },
      },
    },
  );

  assert.equal(response.status, 400);
  assert.equal(response.body.error, "Invalid parts-helper request.");
  assert.equal(searched, false);
});

test("repair suggestion input requires workorder scope and a bounded result count", () => {
  const workorderId = "11111111-1111-4111-8111-111111111111";
  const catalogPartId = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(repairSuggestionsInputSchema.parse({
    workorderId,
    catalogPartId,
    partNumber: "  46305  ",
  }), {
    workorderId,
    catalogPartId,
    partNumber: "46305",
    limit: 3,
  });
  assert.equal(repairSuggestionsInputSchema.safeParse({ workorderId, partNumber: "" }).success, false);
  assert.equal(repairSuggestionsInputSchema.safeParse({ workorderId, partNumber: "46305", limit: 6 }).success, false);
  assert.equal(repairSuggestionsInputSchema.safeParse({ workorderId: "bad", partNumber: "46305" }).success, false);
});

test("repair suggestions derive tenant and asset scope from the authorized workorder", async () => {
  const calls = [];
  const requestContext = { actor: { id: "office-1", role: "office" } };
  const result = await getPartRepairSuggestions({
    workorderId: "11111111-1111-4111-8111-111111111111",
    catalogPartId: "22222222-2222-4222-8222-222222222222",
    partNumber: " 46305 ",
    limit: "4",
    companyId: "attacker-company",
    assetId: "attacker-asset",
  }, requestContext, {
    requireWorkorderAccess: async (context, workorderId) => {
      calls.push({ type: "access", context, workorderId });
      return { companyId: "company-1", assetId: "asset-1" };
    },
    suggestCompanyPartRepairs: async (companyId, options) => {
      calls.push({ type: "suggest", companyId, options });
      return [{
        text: "Put new hub seal, adjust brakes",
        usageCount: 8,
        latestUsedAt: "2026-07-10T12:00:00.000Z",
        confidence: "confirmed",
        source: "odoo",
        sameAsset: true,
        examples: [{
          workorderId: null,
          serviceOrderId: "service-order-1",
          reference: "SO-1042",
          assetId: "asset-1",
          usedAt: "2026-07-10T12:00:00.000Z",
        }],
      }];
    },
  });

  assert.deepEqual(calls[0], {
    type: "access",
    context: requestContext,
    workorderId: "11111111-1111-4111-8111-111111111111",
  });
  assert.deepEqual(calls[1], {
    type: "suggest",
    companyId: "company-1",
    options: {
      catalogPartId: "22222222-2222-4222-8222-222222222222",
      partNumber: "46305",
      assetId: "asset-1",
      limit: 4,
    },
  });
  assert.deepEqual(result, {
    partNumber: "46305",
    suggestions: [{
      text: "Put new hub seal, adjust brakes",
      usageCount: 8,
      latestUsedAt: "2026-07-10T12:00:00.000Z",
      confidence: "confirmed",
      source: "odoo",
      sameAsset: true,
      examples: [{
        usedAt: "2026-07-10T12:00:00.000Z",
      }],
    }],
  });
});

test("repair suggestions stop before history lookup when workorder access fails", async () => {
  const denied = Object.assign(new Error("Workorder not found."), { statusCode: 404 });
  let searched = false;
  await assert.rejects(
    () => getPartRepairSuggestions({
      workorderId: "11111111-1111-4111-8111-111111111111",
      partNumber: "46305",
    }, { actor: { id: "office-1", role: "office" } }, {
      requireWorkorderAccess: async () => { throw denied; },
      suggestCompanyPartRepairs: async () => {
        searched = true;
        return [];
      },
    }),
    (error) => error === denied,
  );
  assert.equal(searched, false);
});

test("repair suggestions return a stable empty response", async () => {
  const result = await getPartRepairSuggestions({
    workorderId: "11111111-1111-4111-8111-111111111111",
    partNumber: "46305",
  }, {}, {
    requireWorkorderAccess: async () => ({ companyId: "company-1", assetId: null }),
    suggestCompanyPartRepairs: async () => null,
  });
  assert.deepEqual(result, { partNumber: "46305", suggestions: [] });
});

test("repair suggestions bound repository strings, examples, and result count", async () => {
  const longText = "x".repeat(2200);
  const suggestion = {
    text: longText,
    usageCount: 2_000_000,
    latestUsedAt: "not-a-date",
    confidence: "unexpected",
    source: "mixed",
    examples: Array.from({ length: 4 }, (_, index) => ({
      workorderId: `workorder-${index}`,
      serviceOrderId: `service-${index}`,
      reference: "r".repeat(250),
      assetId: `asset-${index}`,
      usedAt: null,
    })),
  };
  const result = await getPartRepairSuggestions({
    workorderId: "11111111-1111-4111-8111-111111111111",
    partNumber: "46305",
    limit: 2,
  }, {}, {
    requireWorkorderAccess: async () => ({ companyId: "company-1", assetId: null }),
    suggestCompanyPartRepairs: async () => [suggestion, suggestion, suggestion],
  });

  assert.equal(result.suggestions.length, 2);
  assert.equal(result.suggestions[0].text.length, 2000);
  assert.equal(result.suggestions[0].usageCount, 1_000_000);
  assert.equal(result.suggestions[0].latestUsedAt, null);
  assert.equal(result.suggestions[0].confidence, "context");
  assert.equal(result.suggestions[0].source, "mixed");
  assert.equal(result.suggestions[0].sameAsset, false);
  assert.equal(result.suggestions[0].examples.length, 3);
  assert.deepEqual(result.suggestions[0].examples[0], { usedAt: null });
});

test("repair suggestions route forwards only supported query fields", async () => {
  const calls = [];
  const response = {};
  await handlePartsHelperApi(
    { method: "GET" },
    response,
    new URL("http://localhost/api/parts-helper/repair-suggestions?workorderId=11111111-1111-4111-8111-111111111111&catalogPartId=22222222-2222-4222-8222-222222222222&partNumber=46305&limit=5&companyId=other&assetId=other"),
    {
      requestContext: { actor: { id: "office-1", role: "office" } },
      sendJson: (res, status, body) => Object.assign(res, { status, body }),
      readBody: async () => ({}),
      partsHelperDependencies: {
        requireWorkorderAccess: async () => ({ companyId: "company-1", assetId: "asset-1" }),
        suggestCompanyPartRepairs: async (companyId, options) => {
          calls.push({ companyId, options });
          return [];
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { partNumber: "46305", suggestions: [] });
  assert.deepEqual(calls, [{
    companyId: "company-1",
    options: {
      catalogPartId: "22222222-2222-4222-8222-222222222222",
      partNumber: "46305",
      assetId: "asset-1",
      limit: 5,
    },
  }]);
});

test("repair suggestions route rejects invalid input before resolving access", async () => {
  let accessed = false;
  const response = {};
  await handlePartsHelperApi(
    { method: "GET" },
    response,
    new URL("http://localhost/api/parts-helper/repair-suggestions?workorderId=bad&partNumber=&limit=6"),
    {
      requestContext: { actor: { id: "office-1", role: "office" } },
      sendJson: (res, status, body) => Object.assign(res, { status, body }),
      readBody: async () => ({}),
      partsHelperDependencies: {
        requireWorkorderAccess: async () => {
          accessed = true;
          return { companyId: "company-1" };
        },
      },
    },
  );
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "Invalid parts-helper request.");
  assert.equal(accessed, false);
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

test("identification uses company catalog without calling AI", async () => {
  let aiCalled = false;
  const result = await identifyPart({
    query: "LF9009",
    vehicle: { make: "Freightliner", model: "Cascadia" },
  }, {
    companyId: "company-1",
    findCatalogPart: async () => ({
      partNumber: "LF9009",
      manufacturer: "Fleetguard",
      description: "Engine oil filter",
      category: "lube_filter",
      uomCode: "case",
      repairOrder: "Replace engine oil filter.",
    }),
    identifyWithOpenAI: async () => {
      aiCalled = true;
      throw new Error("AI must not run");
    },
  });

  assert.equal(result.resolutionSource, "company_catalog");
  assert.equal(result.experimental, false);
  assert.equal(result.part.description, "Engine oil filter");
  assert.equal(result.part.uomCode, "case");
  assert.equal(aiCalled, false);
});

test("AI cannot silently replace an exact part number", async () => {
  const result = await identifyPart({
    query: "ZX-9911",
    vehicle: { make: "Freightliner", model: "Cascadia" },
  }, {
    companyId: "company-1",
    findCatalogPart: async () => null,
    findTruckContext: async () => ({ family: "cascadia" }),
    identifyWithOpenAI: async () => ({
      result: {
        status: "matched",
        normalizedPartNumber: "ZX-9917",
        manufacturer: "Example",
        description: "Candidate",
        category: "unknown",
        suggestedQuantity: 1,
        repairOrder: "",
        fitmentStatus: "possible",
        confidence: 90,
        evidenceSummary: "Search candidate.",
        cautions: [],
        alternatives: [],
      },
      sources: [],
      consultedSourceCount: 1,
    }),
  });

  assert.equal(result.part.normalizedPartNumber, "ZX-9911");
  assert.equal(result.part.status, "ambiguous");
  assert.equal(result.part.fitmentStatus, "unknown");
  assert.ok(result.part.confidence <= 40);
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
  assert.ok(requestBody.text.format.schema.required.includes("uomCode"));
  assert.ok(requestBody.text.format.schema.properties.uomCode.enum.includes("gal"));
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
