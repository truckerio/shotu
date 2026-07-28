import { partsHelperConfig } from "../parts-helper/parts-helper.config.js";
import { findHuggingFaceTruckContext } from "../parts-helper/providers/huggingface.provider.js";
import { identifyOfficePartRequestWithOpenAI } from "../parts-helper/providers/openai.provider.js";
import { requireSupportedTruck } from "../parts-helper/supported-trucks.js";
import { findCompanyCatalogPart } from "../../db/repositories/parts-catalog.repo.js";
import { DEFAULT_UOM_CODE } from "../../../../shared/units-of-measure.js";

function inferredMake(make, model) {
  if (make) return make;
  const value = String(model || "").toLowerCase();
  if (value.includes("volvo")) return "Volvo";
  if (value.includes("peterbilt")) return "Peterbilt";
  if (value.includes("freightliner") || value.includes("cascadia")) return "Freightliner";
  return "";
}

function engineSerialFromProviderData(rawProviderData) {
  const data = rawProviderData || {};
  return String(data.engineSerial || data.esn || data.engine?.serial || data.externalIds?.engineSerial || "").trim();
}

function inferredDetroitEngine(engineSerial) {
  const prefix = String(engineSerial || "").replace(/[^a-z0-9]/gi, "").slice(0, 3);
  if (prefix === "471") return "Detroit DD13";
  if (prefix === "472") return "Detroit DD15";
  if (prefix === "473") return "Detroit DD16";
  return "";
}

function engineFromProviderData(rawProviderData, engineSerial) {
  const data = rawProviderData || {};
  return String(
    data.engine?.name
    || data.engine
    || data.engineName
    || data.engineModel
    || data.externalIds?.engine
    || inferredDetroitEngine(engineSerial)
    || ""
  ).trim();
}

export function mechanicChatVehicleContext(row) {
  const form = row?.form_data || {};
  const model = String(row?.model || form.model || "").trim();
  const engineSerial = engineSerialFromProviderData(row?.raw_provider_data);
  return {
    assetId: row?.asset_id || "",
    unitNo: row?.unit_no || row?.asset_name || form.unitNo || "",
    vin: row?.vin || form.vinNo || "",
    make: inferredMake(row?.make, model),
    model,
    ...(row?.year ? { year: Number(row.year) } : {}),
    engine: engineFromProviderData(row?.raw_provider_data, engineSerial),
    engineSerial,
  };
}

function catalogIdentification(part) {
  return {
    status: "matched",
    normalizedPartNumber: part.partNumber,
    manufacturer: part.manufacturer,
    description: part.description,
    category: part.category,
    suggestedQuantity: 1,
    uomCode: part.uomCode || DEFAULT_UOM_CODE,
    repairOrder: part.repairOrder,
    fitmentStatus: "unknown",
    confidence: 100,
    evidenceSummary: "Matched company-approved parts data.",
    cautions: ["Office must still verify fitment for the selected unit."],
    alternatives: [],
  };
}

function typedPartIdentification(partNumber, description) {
  return {
    status: "ambiguous",
    normalizedPartNumber: partNumber,
    manufacturer: "",
    description: description || "",
    category: "",
    suggestedQuantity: 1,
    uomCode: DEFAULT_UOM_CODE,
    repairOrder: "",
    fitmentStatus: "unknown",
    confidence: 0,
    evidenceSummary: "Part number supplied by mechanic; no company-approved match exists yet.",
    cautions: ["Office verification is required before approval or ordering."],
    alternatives: [],
  };
}

export async function identifyMechanicChatPart({
  message,
  imageDataUrl,
  partNumber = "",
  partDescription = "",
  workorderContext,
}, dependencies = {}) {
  const findCatalogPart = dependencies.findCatalogPart || findCompanyCatalogPart;
  const catalogPart = await findCatalogPart(
    workorderContext?.company_id,
    partNumber || partDescription || message,
  );
  if (catalogPart) {
    return {
      part: catalogIdentification(catalogPart),
      sources: [],
      consultedSourceCount: 0,
      resolutionSource: "company_catalog",
      vehicle: mechanicChatVehicleContext(workorderContext),
    };
  }

  // A mechanic's exact input is the durable truth. Save unknown numbers for
  // office review immediately instead of delaying chat or letting AI replace it.
  if (partNumber) {
    return {
      part: typedPartIdentification(partNumber, partDescription),
      sources: [],
      consultedSourceCount: 0,
      resolutionSource: "mechanic_input",
      vehicle: mechanicChatVehicleContext(workorderContext),
    };
  }

  const config = dependencies.config || partsHelperConfig;
  if (!config.openAiApiKey) {
    const error = new Error("Parts helper is not configured.");
    error.code = "PARTS_HELPER_UNAVAILABLE";
    throw error;
  }

  const vehicle = mechanicChatVehicleContext(workorderContext);
  requireSupportedTruck(vehicle);
  const findTruckContext = dependencies.findTruckContext || findHuggingFaceTruckContext;
  const identifyWithOpenAI = dependencies.identifyWithOpenAI || identifyOfficePartRequestWithOpenAI;
  const truckContext = await findTruckContext(vehicle, dependencies.huggingFaceOptions);
  const openAiOptions = {
    ...dependencies.openAiOptions,
    // Chat must remain responsive even when photo recognition is unavailable.
    timeoutMs: dependencies.openAiOptions?.timeoutMs || 8_000,
  };
  const identification = await identifyWithOpenAI({
    message: message || "",
    imageUrl: imageDataUrl || undefined,
    vehicle,
  }, truckContext, openAiOptions);

  return {
    part: identification.result,
    sources: identification.sources || [],
    consultedSourceCount: identification.consultedSourceCount ?? identification.sources?.length ?? 0,
    resolutionSource: "ai_suggestion",
    vehicle,
  };
}
