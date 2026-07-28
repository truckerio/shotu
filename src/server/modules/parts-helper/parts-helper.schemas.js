import { z } from "zod";
import {
  quantitySchema,
  uomCodeSchema,
  validateQuantityUnit,
} from "../parts/quantity-uom.js";

const optionalText = z.string().trim().max(500).optional().default("");

export const vehicleInputSchema = z.object({
  assetId: optionalText,
  unitNo: optionalText,
  vin: optionalText,
  make: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(120),
  year: z.coerce.number().int().min(1950).max(2100).optional(),
  engine: optionalText,
  engineSerial: optionalText,
});

export const locationInputSchema = z.object({
  country: z.string().trim().length(2).default("US"),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().max(20).optional().default(""),
  timezone: z.string().trim().max(100).optional().default("America/Los_Angeles"),
});

export const identifyPartInputSchema = z.object({
  query: z.string().trim().min(2).max(200),
  vehicle: vehicleInputSchema,
  location: locationInputSchema.optional(),
});

export const identifyPartResultSchema = z.object({
  status: z.enum(["matched", "ambiguous", "not_found"]),
  normalizedPartNumber: z.string(),
  manufacturer: z.string(),
  description: z.string(),
  category: z.string(),
  suggestedQuantity: quantitySchema,
  uomCode: uomCodeSchema,
  repairOrder: z.string(),
  fitmentStatus: z.enum(["confirmed", "possible", "unknown", "conflict"]),
  confidence: z.number().int().min(0).max(100),
  evidenceSummary: z.string(),
  cautions: z.array(z.string()),
  alternatives: z.array(z.object({
    partNumber: z.string(),
    description: z.string(),
    reason: z.string(),
  })),
}).superRefine((value, context) => validateQuantityUnit(value, context, ["suggestedQuantity"]));

export const livePriceInputSchema = z.object({
  partNumber: z.string().trim().min(2).max(200),
  manufacturer: optionalText,
  description: z.string().trim().min(2).max(500),
  quantity: quantitySchema.default(1),
  uomCode: uomCodeSchema,
  vehicle: vehicleInputSchema,
  location: locationInputSchema,
}).superRefine(validateQuantityUnit);

const supportedImageUrlSchema = z.string().trim().min(1).max(15_000_000).refine(
  (value) => /^https:\/\//i.test(value) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value),
  "Image must be an HTTPS URL or PNG/JPEG/WebP/GIF data URL.",
);

export const officePartRequestInputSchema = z.object({
  message: z.string().trim().max(1000).optional().default(""),
  imageUrl: supportedImageUrlSchema.optional(),
  vehicle: vehicleInputSchema,
  location: locationInputSchema,
}).superRefine((value, context) => {
  if (!value.message && !value.imageUrl) {
    context.addIssue({ code: "custom", path: ["message"], message: "Photo or mechanic message is required." });
  }
});

export const livePriceModelResultSchema = z.object({
  status: z.enum(["found", "not_found"]),
  currency: z.string().length(3),
  cautions: z.array(z.string()),
  listings: z.array(z.object({
    vendor: z.string(),
    title: z.string(),
    condition: z.enum(["new", "remanufactured", "used", "unknown"]),
    itemPrice: z.number().positive(),
    shippingPrice: z.number().min(0).nullable(),
    availability: z.string(),
    pickup: z.string(),
    fitmentStatus: z.enum(["confirmed", "possible", "unknown", "conflict"]),
    fitmentClaim: z.string(),
    url: z.string().url(),
  })),
});
