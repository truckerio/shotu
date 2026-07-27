import { partsHelperConfig } from "../parts-helper/parts-helper.config.js";
import { findHuggingFaceTruckContext } from "../parts-helper/providers/huggingface.provider.js";
import { identifyOfficePartRequestWithOpenAI } from "../parts-helper/providers/openai.provider.js";
import { requireSupportedTruck } from "../parts-helper/supported-trucks.js";

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

export async function identifyMechanicChatPart({ message, imageDataUrl, workorderContext }, dependencies = {}) {
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
  const identification = await identifyWithOpenAI({
    message: message || "",
    imageUrl: imageDataUrl || undefined,
    vehicle,
  }, truckContext, dependencies.openAiOptions);

  return {
    part: identification.result,
    sources: identification.sources || [],
    consultedSourceCount: identification.consultedSourceCount ?? identification.sources?.length ?? 0,
    vehicle,
  };
}
