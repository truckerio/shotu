import { identifyPartInputSchema, livePriceInputSchema, officePartRequestInputSchema } from "./parts-helper.schemas.js";
import { requireSupportedTruck } from "./supported-trucks.js";
import { findHuggingFaceTruckContext } from "./providers/huggingface.provider.js";
import { findLivePricesWithOpenAI, identifyOfficePartRequestWithOpenAI, identifyPartWithOpenAI } from "./providers/openai.provider.js";
import { findCompanyCatalogPart } from "../../db/repositories/parts-catalog.repo.js";
import { normalizePartNumber } from "../parts/part.constants.js";

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
