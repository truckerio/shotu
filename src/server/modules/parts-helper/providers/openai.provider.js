import { partsHelperConfig } from "../parts-helper.config.js";
import { identifyPartResultSchema, livePriceModelResultSchema } from "../parts-helper.schemas.js";

export class PartsHelperProviderError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = "PartsHelperProviderError";
    this.statusCode = statusCode;
  }
}

const identificationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "normalizedPartNumber", "manufacturer", "description", "category", "suggestedQuantity", "repairOrder", "fitmentStatus", "confidence", "evidenceSummary", "cautions", "alternatives"],
  properties: {
    status: { type: "string", enum: ["matched", "ambiguous", "not_found"] },
    normalizedPartNumber: { type: "string" },
    manufacturer: { type: "string" },
    description: { type: "string" },
    category: { type: "string" },
    suggestedQuantity: { type: "integer", minimum: 1, maximum: 100 },
    repairOrder: { type: "string" },
    fitmentStatus: { type: "string", enum: ["confirmed", "possible", "unknown", "conflict"] },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    evidenceSummary: { type: "string" },
    cautions: { type: "array", items: { type: "string" } },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["partNumber", "description", "reason"],
        properties: {
          partNumber: { type: "string" },
          description: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
};

const priceJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "currency", "cautions", "listings"],
  properties: {
    status: { type: "string", enum: ["found", "not_found"] },
    currency: { type: "string", minLength: 3, maxLength: 3 },
    cautions: { type: "array", items: { type: "string" } },
    listings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["vendor", "title", "condition", "itemPrice", "shippingPrice", "availability", "pickup", "fitmentStatus", "fitmentClaim", "url"],
        properties: {
          vendor: { type: "string" },
          title: { type: "string" },
          condition: { type: "string", enum: ["new", "remanufactured", "used", "unknown"] },
          itemPrice: { type: "number", exclusiveMinimum: 0 },
          shippingPrice: { type: ["number", "null"], minimum: 0 },
          availability: { type: "string" },
          pickup: { type: "string" },
          fitmentStatus: { type: "string", enum: ["confirmed", "possible", "unknown", "conflict"] },
          fitmentClaim: { type: "string" },
          url: { type: "string" },
        },
      },
    },
  },
};

function outputText(response) {
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "refusal") throw new PartsHelperProviderError(content.refusal || "OpenAI refused request.", 422);
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new PartsHelperProviderError("OpenAI returned no structured result.");
}

function collectSources(response) {
  const consulted = [];
  const citations = [];
  for (const item of response.output || []) {
    for (const source of item.action?.sources || []) {
      if (source?.url) consulted.push({ url: source.url, title: source.title || "" });
    }
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) {
        if (annotation.type === "url_citation" && annotation.url) citations.push({ url: annotation.url, title: annotation.title || "" });
      }
    }
  }
  const unique = (sources) => [...new Map(sources.map((source) => [source.url, source])).values()];
  return { consulted: unique([...consulted, ...citations]), citations: unique(citations) };
}

function webSearchTool(location) {
  return {
    type: "web_search",
    external_web_access: true,
    search_context_size: "medium",
    ...(location ? {
      user_location: {
        type: "approximate",
        country: location.country,
        city: location.city,
        region: location.region,
        timezone: location.timezone,
      },
    } : {}),
  };
}

async function createResponse({ input, schema, schemaName, location, options }) {
  const config = options.config || partsHelperConfig;
  const fetchFn = options.fetchFn || fetch;
  if (!config.openAiApiKey) throw new PartsHelperProviderError("OPENAI_API_KEY is required for live parts-helper requests.", 503);

  const response = await fetchFn(`${config.openAiBaseUrl}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.openAiApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.openAiModel,
      reasoning: { effort: "low" },
      store: false,
      tools: [webSearchTool(location)],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      text: {
        verbosity: "low",
        format: { type: "json_schema", name: schemaName, strict: true, schema },
      },
      input,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || `OpenAI request failed (${response.status}).`;
    throw new PartsHelperProviderError(detail, response.status === 401 ? 503 : 502);
  }
  return { body, ...collectSources(body) };
}

export async function identifyPartWithOpenAI(input, truckContext, options = {}) {
  const prompt = [
    "Identify a heavy-truck part from mechanic input. Search web before answering.",
    "Use source-supported facts only. Preserve exact part-number letters and digits.",
    "Hugging Face truck data is vehicle/engine context only; it is not fitment proof.",
    "Use engineSerial as stronger fitment context than truck year/model. Search the engine serial and engine family explicitly.",
    "Set fitment confirmed only when manufacturer or OEM evidence explicitly supports the selected engine, engine serial, or VIN. Retailer model-only claims are possible, not confirmed.",
    "If an exact part number cannot be proven, return ambiguous and include source-supported candidate part numbers in alternatives instead of guessing one.",
    "Repair order is a short editable recommended instruction, not a claim work was completed.",
    `Mechanic request: ${input.query}`,
    `Selected vehicle: ${JSON.stringify(input.vehicle)}`,
    `Hugging Face vehicle context: ${JSON.stringify(truckContext)}`,
  ].join("\n");
  const response = await createResponse({ input: prompt, schema: identificationJsonSchema, schemaName: "part_identification", location: input.location, options });
  return {
    result: identifyPartResultSchema.parse(JSON.parse(outputText(response.body))),
    sources: response.citations.length ? response.citations : response.consulted.slice(0, 5),
    consultedSourceCount: response.consulted.length,
  };
}

export async function identifyOfficePartRequestWithOpenAI(input, truckContext, options = {}) {
  const prompt = [
    "Identify a heavy-truck part requested by a mechanic. Search web before answering.",
    "Read visible manufacturer and part-number text from photo when present.",
    "Photo, retailer metadata, mechanic message, and vehicle context can conflict. Do not force agreement.",
    "Use source-supported facts only. Preserve exact part-number letters and digits.",
    "Hugging Face truck data is vehicle/engine context only; it is not part or fitment proof.",
    "Use engineSerial as stronger fitment context than truck year/model. Search the engine serial and engine family explicitly.",
    "If photo text is unreadable or evidence conflicts, return ambiguous or not_found.",
    "Set fitment confirmed only when manufacturer or OEM evidence explicitly supports the selected engine, engine serial, or VIN. Retailer model-only claims are possible, not confirmed.",
    "If an exact part number cannot be proven, return ambiguous and include source-supported candidate part numbers in alternatives instead of guessing one.",
    "Repair order is a short editable recommended instruction, not a claim work was completed.",
    `Mechanic message: ${input.message || "No text supplied; identify photo."}`,
    `Selected vehicle: ${JSON.stringify(input.vehicle)}`,
    `Hugging Face vehicle context: ${JSON.stringify(truckContext)}`,
  ].join("\n");
  const content = [{ type: "input_text", text: prompt }];
  if (input.imageUrl) content.push({ type: "input_image", image_url: input.imageUrl, detail: "high" });
  const response = await createResponse({
    input: [{ role: "user", content }],
    schema: identificationJsonSchema,
    schemaName: "office_part_identification",
    location: input.location,
    options,
  });
  return {
    result: identifyPartResultSchema.parse(JSON.parse(outputText(response.body))),
    sources: response.citations.length ? response.citations : response.consulted.slice(0, 5),
    consultedSourceCount: response.consulted.length,
  };
}

export async function findLivePricesWithOpenAI(input, truckContext, options = {}) {
  const today = new Date().toISOString();
  const prompt = [
    "Find current purchasable heavy-truck part listings. Search live web before answering.",
    `Search time: ${today}`,
    "Return direct product URLs with visible numeric prices only. Do not estimate missing prices.",
    "Keep new, remanufactured, and used conditions distinct.",
    "For each listing, set fitment confirmed only when manufacturer or OEM evidence explicitly supports the selected engine, engine serial, or VIN. Retailer model-only claims are possible, not confirmed.",
    "Prefer vendors serving supplied purchasing location. Shipping may be null when not visible.",
    `Part: ${JSON.stringify({ partNumber: input.partNumber, manufacturer: input.manufacturer, description: input.description, quantity: input.quantity })}`,
    `Vehicle: ${JSON.stringify(input.vehicle)}`,
    `Location: ${JSON.stringify(input.location)}`,
    `Hugging Face vehicle context: ${JSON.stringify(truckContext)}`,
  ].join("\n");
  const response = await createResponse({ input: prompt, schema: priceJsonSchema, schemaName: "live_part_prices", location: input.location, options });
  return {
    result: livePriceModelResultSchema.parse(JSON.parse(outputText(response.body))),
    sources: response.consulted,
    consultedSourceCount: response.consulted.length,
  };
}
