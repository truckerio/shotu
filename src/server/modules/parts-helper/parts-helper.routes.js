import { ZodError } from "zod";
import { partsHelperConfig } from "./parts-helper.config.js";
import { findLivePartPrices, identifyPart, resolveOfficePartRequest } from "./parts-helper.service.js";
import { supportedTruckLabels } from "./supported-trucks.js";

function sendError(sendJson, res, error) {
  if (error instanceof ZodError) {
    sendJson(res, 400, { error: "Invalid parts-helper request.", issues: error.issues });
    return;
  }
  sendJson(res, error.statusCode || 500, { error: error.message || "Parts helper failed." });
}

export async function handlePartsHelperApi(req, res, url, helpers) {
  const { sendJson, readBody } = helpers;
  if (!url.pathname.startsWith("/api/parts-helper")) return false;

  if (req.method === "GET" && url.pathname === "/api/parts-helper/status") {
    sendJson(res, 200, {
      experimental: true,
      enabled: true,
      openAiConfigured: Boolean(partsHelperConfig.openAiApiKey),
      huggingFaceDataset: partsHelperConfig.huggingFaceDataset,
      supportedTrucks: supportedTruckLabels,
    });
    return true;
  }

  try {
    if (req.method === "POST" && url.pathname === "/api/parts-helper/identify") {
      sendJson(res, 200, await identifyPart(await readBody(req)));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/parts-helper/live-prices") {
      sendJson(res, 200, await findLivePartPrices(await readBody(req)));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/parts-helper/office-request") {
      sendJson(res, 200, await resolveOfficePartRequest(await readBody(req)));
      return true;
    }
  } catch (error) {
    sendError(sendJson, res, error);
    return true;
  }

  sendJson(res, 404, { error: "Unknown parts-helper route." });
  return true;
}
