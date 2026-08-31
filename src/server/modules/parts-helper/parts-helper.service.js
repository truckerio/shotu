import {
  catalogSearchInputSchema,
  identifyPartInputSchema,
  livePriceInputSchema,
  officePartRequestInputSchema,
  repairSuggestionsInputSchema,
} from "./parts-helper.schemas.js";
import { requireSupportedTruck } from "./supported-trucks.js";
import { findHuggingFaceTruckContext } from "./providers/huggingface.provider.js";
import { findLivePricesWithOpenAI, identifyOfficePartRequestWithOpenAI, identifyPartWithOpenAI } from "./providers/openai.provider.js";
import {
  findCompanyCatalogPart,
  searchCompanyCatalogParts,
} from "../../db/repositories/parts-catalog.repo.js";
import { suggestCompanyPartRepairs } from "../../db/repositories/service-history.repo.js";
import { getLocationById } from "../../db/repositories/locations.repo.js";
import { normalizePartNumber } from "../parts/part.constants.js";
import { requireWorkorderAccess } from "../../auth/resource-access.js";
import { requireActor, requireCompanyAccess, requireLocationAccess, requirePermission } from "../../auth/authorize.js";
import { PERMISSION } from "../../auth/permissions.js";
import { resourceNotFound } from "../../auth/errors.js";

const normalizedUrl = (value) => {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return "";
  }
};

function sourceBacked(url, sources) {
  const listing = normalizedUrl(url);
  return Boolean(listing) && sources.some((source) => {
    const evidence = normalizedUrl(source.url);
    return evidence === listing || evidence.startsWith(`${listing}/`) || listing.startsWith(`${evidence}/`);
  });
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeListings(listings, valueField = "totalPrice") {
  const groups = {};
  for (const condition of ["new", "remanufactured", "used", "unknown"]) {
    const values = listings
      .filter((listing) => listing.condition === condition && Number.isFinite(listing[valueField]))
      .map((listing) => listing[valueField]);
    if (!values.length) continue;
    groups[condition] = {
      count: values.length,
      lowest: roundMoney(Math.min(...values)),
      average: roundMoney(values.reduce((total, value) => total + value, 0) / values.length),
      median: roundMoney(median(values)),
      highest: roundMoney(Math.max(...values)),
    };
  }
  return groups;
}

export async function searchPartCatalog(input, requestContext, dependencies = {}) {
  const parsed = catalogSearchInputSchema.parse(input);
  const requireAccess = dependencies.requireWorkorderAccess || requireWorkorderAccess;
  const getLocation = dependencies.getLocationById || getLocationById;
  const searchCatalog = dependencies.searchCatalogParts || searchCompanyCatalogParts;
  let scope;
  if (parsed.workorderId) {
    const workorder = await requireAccess(requestContext, parsed.workorderId);
    scope = { companyId: workorder.companyId, locationId: workorder.locationId || null };
  } else {
    requireActor(requestContext);
    const location = await getLocation(parsed.locationId, [...(requestContext.companyIds || [])]);
    if (!location) throw resourceNotFound("Location");
    requireCompanyAccess(requestContext, location.company_id);
    requireLocationAccess(requestContext, location.id);
    scope = { companyId: location.company_id, locationId: location.id };
  }
  if (parsed.purpose === "master_match") {
    (dependencies.requirePermission || requirePermission)(requestContext, PERMISSION.INVENTORY_COUNT_APPLY);
  }
  const result = await searchCatalog(scope.companyId, {
    text: parsed.q,
    locationId: scope.locationId,
    limit: parsed.limit,
    purpose: parsed.purpose,
  });

  const items = Array.isArray(result?.items) ? result.items : [];
  const scopedItems = ["master_match", "workorder_assignment"].includes(parsed.purpose)
    ? items
    : items.filter((item) => item?.source === "local"
      && item.inventory?.locationId === scope.locationId
      && (parsed.purpose !== "issue" || Number(item.inventory?.available) > 0));

  return {
    query: parsed.q,
    catalogAvailable: Boolean(result?.catalogAvailable),
    items: scopedItems,
  };
}

const boundedText = (value, maxLength) => String(value ?? "").trim().slice(0, maxLength);

function isoDateOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function publicRepairSuggestion(suggestion) {
  const text = boundedText(suggestion?.text, 2000);
  if (!text) return null;
  const source = ["local", "odoo", "mixed"].includes(suggestion?.source) ? suggestion.source : "local";
  return {
    text,
    usageCount: Math.min(1_000_000, Math.max(0, Math.trunc(Number(suggestion?.usageCount) || 0))),
    latestUsedAt: isoDateOrNull(suggestion?.latestUsedAt),
    confidence: suggestion?.confidence === "confirmed" ? "confirmed" : "context",
    source,
    sameAsset: Boolean(suggestion?.sameAsset),
    examples: (Array.isArray(suggestion?.examples) ? suggestion.examples : []).slice(0, 3).map((example) => ({
      usedAt: isoDateOrNull(example?.usedAt),
    })),
  };
}

export async function getPartRepairSuggestions(input, requestContext, dependencies = {}) {
  const parsed = repairSuggestionsInputSchema.parse(input);
  const requireAccess = dependencies.requireWorkorderAccess || requireWorkorderAccess;
  const suggestRepairs = dependencies.suggestCompanyPartRepairs || suggestCompanyPartRepairs;
  const workorder = await requireAccess(requestContext, parsed.workorderId);
  const suggestions = await suggestRepairs(workorder.companyId, {
    catalogPartId: parsed.catalogPartId || null,
    partNumber: parsed.partNumber,
    assetId: workorder.assetId || workorder.asset?.id || null,
    limit: parsed.limit,
  });

  return {
    partNumber: parsed.partNumber,
    suggestions: (Array.isArray(suggestions) ? suggestions : [])
      .slice(0, parsed.limit)
      .map(publicRepairSuggestion)
      .filter(Boolean),
  };
}

export async function identifyPart(input, dependencies = {}) {
  const parsed = identifyPartInputSchema.parse(input);
  const findCatalogPart = dependencies.findCatalogPart || findCompanyCatalogPart;
  const catalogPart = await findCatalogPart(dependencies.companyId, parsed.query);
  if (catalogPart) {
    return {
      experimental: false,
      family: null,
      searchedAt: new Date().toISOString(),
      vehicleContext: null,
      resolutionSource: "company_catalog",
      part: {
        status: "matched",
        normalizedPartNumber: catalogPart.partNumber,
        manufacturer: catalogPart.manufacturer,
        description: catalogPart.description,
        category: catalogPart.category,
        suggestedQuantity: 1,
        uomCode: catalogPart.uomCode,
        repairOrder: catalogPart.repairOrder,
        fitmentStatus: "unknown",
        confidence: 100,
        evidenceSummary: "Matched company-approved parts data.",
        cautions: ["Verify fitment for the selected unit before approval."],
        alternatives: [],
      },
      sources: [],
      consultedSourceCount: 0,
    };
  }
  const family = requireSupportedTruck(parsed.vehicle);
  const hfLookup = dependencies.findTruckContext || findHuggingFaceTruckContext;
  const openAiLookup = dependencies.identifyWithOpenAI || identifyPartWithOpenAI;
  const truckContext = await hfLookup(parsed.vehicle, dependencies.huggingFaceOptions);
  const identification = await openAiLookup(parsed, truckContext, dependencies.openAiOptions);
  const explicitNumber = /^[A-Za-z0-9][A-Za-z0-9-]{3,29}$/.test(parsed.query)
    && /[A-Za-z]/.test(parsed.query)
    && /\d/.test(parsed.query)
    ? parsed.query
    : "";
  const aiPart = identification.result;
  const part = explicitNumber
    && normalizePartNumber(aiPart.normalizedPartNumber) !== normalizePartNumber(explicitNumber)
    ? {
      ...aiPart,
      status: "ambiguous",
      normalizedPartNumber: explicitNumber,
      fitmentStatus: "unknown",
      confidence: Math.min(aiPart.confidence, 40),
      evidenceSummary: "Preserved the exact part number entered by the user; AI returned a different candidate.",
      cautions: [
        ...aiPart.cautions,
        `AI suggested ${aiPart.normalizedPartNumber || "a different part"}; office verification is required.`,
      ],
    }
    : aiPart;

  return {
    experimental: true,
    family,
    searchedAt: new Date().toISOString(),
    vehicleContext: truckContext,
    resolutionSource: "ai_suggestion",
    part,
    sources: identification.sources,
    consultedSourceCount: identification.consultedSourceCount ?? identification.sources.length,
  };
}

export async function findLivePartPrices(input, dependencies = {}) {
  const parsed = livePriceInputSchema.parse(input);
  const family = requireSupportedTruck(parsed.vehicle);
  const hfLookup = dependencies.findTruckContext || findHuggingFaceTruckContext;
  const openAiLookup = dependencies.findPricesWithOpenAI || findLivePricesWithOpenAI;
  const truckContext = await hfLookup(parsed.vehicle, dependencies.huggingFaceOptions);
  const pricing = await openAiLookup(parsed, truckContext, dependencies.openAiOptions);
  return formatPricingResult(parsed, family, truckContext, pricing);
}

function formatPricingResult(parsed, family, truckContext, pricing) {
  const sourceBackedListings = pricing.result.listings
    .filter((listing) => sourceBacked(listing.url, pricing.sources))
    .map((listing) => ({
      ...listing,
      totalPrice: listing.shippingPrice === null ? null : roundMoney(listing.itemPrice + listing.shippingPrice),
      shippingKnown: listing.shippingPrice !== null,
    }))
    .sort((a, b) => (a.totalPrice ?? Infinity) - (b.totalPrice ?? Infinity));

  return {
    experimental: true,
    family,
    searchedAt: new Date().toISOString(),
    vehicleContext: truckContext,
    currency: pricing.result.currency,
    listings: sourceBackedListings,
    excludedListings: pricing.result.listings.length - sourceBackedListings.length,
    itemPriceComparisonByCondition: summarizeListings(sourceBackedListings, "itemPrice"),
    landedPriceComparisonByCondition: summarizeListings(sourceBackedListings, "totalPrice"),
    cautions: pricing.result.cautions,
    sources: sourceBackedListings.map((listing) => ({ url: listing.url, title: listing.title, vendor: listing.vendor })),
    consultedSourceCount: pricing.consultedSourceCount ?? pricing.sources.length,
  };
}

export async function resolveOfficePartRequest(input, dependencies = {}) {
  const parsed = officePartRequestInputSchema.parse(input);
  const family = requireSupportedTruck(parsed.vehicle);
  const hfLookup = dependencies.findTruckContext || findHuggingFaceTruckContext;
  const officeLookup = dependencies.identifyOfficeWithOpenAI || identifyOfficePartRequestWithOpenAI;
  const priceLookup = dependencies.findPricesWithOpenAI || findLivePricesWithOpenAI;
  const truckContext = await hfLookup(parsed.vehicle, dependencies.huggingFaceOptions);
  const identification = await officeLookup(parsed, truckContext, dependencies.openAiOptions);
  const base = {
    experimental: true,
    family,
    searchedAt: new Date().toISOString(),
    vehicleContext: truckContext,
    part: identification.result,
    sources: identification.sources,
    consultedSourceCount: identification.consultedSourceCount ?? identification.sources.length,
  };

  if (identification.result.status !== "matched" || !identification.result.normalizedPartNumber) {
    return {
      ...base,
      pricing: null,
      nextAction: identification.result.normalizedPartNumber
        ? "Verify the candidate part number and fitment by VIN or engine serial before pricing."
        : "Ask mechanic for a clear label photo or exact part number before pricing.",
    };
  }

  const priceInput = livePriceInputSchema.parse({
    partNumber: identification.result.normalizedPartNumber,
    manufacturer: identification.result.manufacturer,
    description: identification.result.description,
    quantity: identification.result.suggestedQuantity,
    uomCode: identification.result.uomCode,
    vehicle: parsed.vehicle,
    location: parsed.location,
  });
  const pricing = await priceLookup(priceInput, truckContext, dependencies.openAiOptions);
  const formattedPricing = formatPricingResult(priceInput, family, truckContext, pricing);
  const orderFitmentConfirmed = identification.result.fitmentStatus === "confirmed"
    && formattedPricing.listings.some((listing) => listing.fitmentStatus === "confirmed");
  return {
    ...base,
    pricing: formattedPricing,
    nextAction: orderFitmentConfirmed
      ? "Review current listing and select vendor."
      : "Confirm VIN or engine fitment before ordering.",
  };
}
