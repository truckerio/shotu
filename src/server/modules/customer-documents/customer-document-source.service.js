import { AuthError, invalidRequest, resourceNotFound } from "../../auth/errors.js";
import { readCreatePricing } from "../../db/repositories/workorder-create-pricing.repo.js";
import { getUserWorkorderDraft } from "../workorders/workorder-drafts.service.js";
import { readLockedWorkorderFinancialSource } from "../../db/repositories/customer-document-workorder-source.repo.js";
import { createWorkorderSchema } from "../workorders/workorder.schemas.js";

const TAXED = new Set(["exclusive", "inclusive"]);

function conflict(code, message) {
  throw new AuthError(409, code, message);
}

function taxEvidence(profile, lineType) {
  const treatment = profile.lineTaxPolicy?.[lineType];
  if (!treatment || treatment === "not_configured") {
    conflict("CUSTOMER_DOCUMENT_TAX_NOT_CONFIGURED", `Configure customer tax treatment for ${lineType.replaceAll("_", " ")} lines.`);
  }
  return {
    taxCategory: lineType,
    taxTreatment: treatment,
    taxComponents: TAXED.has(treatment) ? profile.taxComponents || [] : [],
  };
}

function adjustmentMaps(adjustments) {
  return {
    discounts: new Map(adjustments.lineDiscounts.map((entry) => [entry.lineId, entry.discount])),
    overrides: new Map(adjustments.overrideReasons.map((entry) => [entry.lineId, entry.reason])),
  };
}

function percentageWithinOfficePolicy(discount, policy) {
  if (!discount) return true;
  if (discount.kind !== "percentage") return false;
  return Number(discount.value) <= Number(policy.maxOfficePercentage || 0);
}

function applyAdjustments(lines, adjustments, context, profile) {
  const { discounts, overrides } = adjustmentMaps(adjustments);
  const lineIds = new Set(lines.map((line) => line.id));
  for (const id of [...discounts.keys(), ...overrides.keys()]) {
    if (!lineIds.has(id)) throw invalidRequest(`Financial adjustment references unknown line ${id}.`);
  }
  if (context.actor.role !== "admin") {
    for (const discount of [...discounts.values(), adjustments.documentDiscount]) {
      if (!percentageWithinOfficePolicy(discount, profile.discountPolicy || {})) {
        throw new AuthError(403, "CUSTOMER_DOCUMENT_DISCOUNT_POLICY_DENIED", "This discount requires Admin approval.");
      }
    }
  }
  const adjusted = lines.map((line) => {
    const overrideReason = overrides.get(line.id) || null;
    if (line.manualOverride && !overrideReason) {
      throw invalidRequest(`A reason is required for the customer price override on ${line.description}.`);
    }
    if (line.manualOverride && context.actor.role !== "admin") {
      throw new AuthError(403, "CUSTOMER_DOCUMENT_PRICE_OVERRIDE_DENIED", "Customer price overrides require Admin approval.");
    }
    if (!line.manualOverride && overrideReason) throw invalidRequest(`Line ${line.id} is not a customer price override.`);
    const { manualOverride: _manualOverride, ...safeLine } = line;
    return {
      ...safeLine,
      priceBasis: line.manualOverride ? "customer_override" : "selling_price",
      lineDiscount: discounts.get(line.id) || null,
      source: { ...line.source, overrideReason, discountReason: discounts.get(line.id)?.reason || null },
    };
  });
  return { lines: adjusted, documentDiscount: adjustments.documentDiscount };
}

function sourceProjection({ source, formData, concern, pricingFingerprint, lines, documentDiscount, profile, documentType = "estimate", basis = "estimated", repairDescription = null, unit = null }) {
  const customerName = formData.customerCompanyName || formData.companyName || null;
  const unitLabel = formData.unitNo || formData.vinNo || "Customer unit";
  return {
    document: {
      id: null, revisionId: null, type: documentType, number: null, revision: null,
      state: "draft_projection", issuedAt: null, expiresAt: null,
    },
    shop: profile.shopIdentity,
    customer: { name: customerName, company: customerName, address: null, email: null, phone: null },
    unit: unit || {
      id: source.assetId || null,
      label: unitLabel,
      vin: formData.vinNo || null,
      make: null,
      model: formData.model || null,
      year: null,
    },
    concern: concern || formData.mechanicConcern || "",
    repairDescription: repairDescription ?? formData.workPerformed ?? "",
    terms: profile.documentTerms?.estimate || "",
    authorizationText: profile.authorizationText,
    warrantyText: profile.documentTerms?.warranty || "",
    footer: profile.documentTerms?.footer || "",
    profileVersionId: profile.id,
    templateVersion: "customer-document-v1",
    taxProfileVersionId: profile.taxProfileVersionId,
    relatedDocuments: [],
    response: { status: "pending", respondedAt: null, customerName: null },
    financial: {
      currency: profile.defaultCurrency,
      basis,
      lines,
      documentDiscount,
    },
    sourceEvidence: { kind: source.kind, id: source.id, version: source.version, pricingFingerprint },
    discountEvidence: { documentDiscount },
  };
}

function draftCreateInput(draft) {
  const result = createWorkorderSchema.safeParse({
    ...draft.payload,
    companyId: draft.companyId,
    locationId: draft.locationId,
    createdByUserId: undefined,
  });
  if (!result.success) throw invalidRequest(result.error.issues[0]?.message || "Complete the required Workorder fields.");
  return result.data;
}

async function draftFinancialSource(context, source, adjustments, profile, dependencies) {
  const draft = await (dependencies.getDraft || getUserWorkorderDraft)(context, source.id);
  if (!draft || draft.status !== "active") conflict("CUSTOMER_DOCUMENT_DRAFT_NOT_ISSUABLE", "This draft is no longer active.");
  if (draft.version !== source.expectedVersion) conflict("CUSTOMER_DOCUMENT_SOURCE_CHANGED", "This draft changed. Refresh the Estimate preview.");
  const input = draftCreateInput(draft);
  const pricing = await (dependencies.readCreatePricing || readCreatePricing)(input);
  const lines = [];
  const pricedParts = new Map(pricing.parts.map((row) => [row.partIndex, row]));
  for (const [index, part] of (input.formData.parts || []).entries()) {
    if (!(part?.partNo || Number(part?.qty) > 0 || part?.repairOrder)) continue;
    if (!part.catalogPartId || part.purchaseRequested) {
      conflict("CUSTOMER_DOCUMENT_SELLING_PRICE_REQUIRED", "Every Estimate part requires an exact inventory source and selling price.");
    }
    const priced = pricedParts.get(index);
    if (priced?.status !== "known" || priced.price?.selection !== "selling_price") {
      conflict("CUSTOMER_DOCUMENT_SELLING_PRICE_REQUIRED", "Every Estimate part must use the current selling price.");
    }
    if (priced.price.currency !== profile.defaultCurrency) conflict("CUSTOMER_DOCUMENT_CURRENCY_MISMATCH", "Estimate prices must use the profile currency.");
    lines.push({
      id: `part:${index}`,
      type: "part",
      description: part.repairOrder || part.partNo || "Part",
      quantity: String(part.qty),
      unit: part.uomCode || "ea",
      unitPrice: String(priced.price.unitPrice),
      manualOverride: priced.price.manualOverride === true,
      discountEligible: true,
      ...taxEvidence(profile, "part"),
      source: {
        kind: "inventory_part",
        id: part.catalogPartId,
        priceVersionId: priced.price.sellingPolicyVersionId || null,
        pricingFingerprint: pricing.fingerprint,
      },
    });
  }
  if (Number(input.formData.laborHours) > 0) {
    if (pricing.labor?.status !== "known" || pricing.labor.price?.selection !== "selling_price") {
      conflict("CUSTOMER_DOCUMENT_SELLING_PRICE_REQUIRED", "Estimate labor must use the current selling rate.");
    }
    if (pricing.labor.price.currency !== profile.defaultCurrency) conflict("CUSTOMER_DOCUMENT_CURRENCY_MISMATCH", "Estimate prices must use the profile currency.");
    lines.unshift({
      id: "labor",
      type: "labor",
      description: input.formData.laborProduct?.description || input.formData.laborProduct?.name || "Labor",
      quantity: String(input.formData.laborHours),
      unit: input.formData.laborProduct?.uomCode === "ea" ? "ea" : "hr",
      unitPrice: String(pricing.labor.price.unitPrice),
      manualOverride: pricing.labor.price.manualOverride === true,
      discountEligible: true,
      ...taxEvidence(profile, "labor"),
      source: {
        kind: pricing.labor.price.sellingPolicyVersionId ? "inventory_selling_policy" : "labor_rate",
        id: input.formData.laborProduct?.productId || "labor",
        priceVersionId: pricing.labor.price.rateVersionId || pricing.labor.price.sellingPolicyVersionId || null,
        pricingFingerprint: pricing.fingerprint,
      },
    });
  }
  if (!lines.length) conflict("CUSTOMER_DOCUMENT_EMPTY_ESTIMATE", "Add priced labor or parts before previewing an Estimate.");
  const adjusted = applyAdjustments(lines, adjustments, context, profile);
  return sourceProjection({
    source: { kind: "draft", id: draft.id, version: draft.version, assetId: input.assetId },
    formData: input.formData,
    concern: input.concern,
    pricingFingerprint: pricing.fingerprint,
    ...adjusted,
    profile,
  });
}

async function workorderFinancialSource(context, source, adjustments, profile, dependencies) {
  const read = dependencies.readWorkorderFinancialSource || readLockedWorkorderFinancialSource;
  if (!dependencies.client) conflict("CUSTOMER_DOCUMENT_WORKORDER_SOURCE_UNAVAILABLE", "Workorder financial sources require a transaction-bound read.");
  let actual;
  try {
    actual = await read({ companyId: dependencies.companyId, locationId: dependencies.locationId, workorderId: source.id }, dependencies.client);
  } catch (error) {
    if (error?.code === "CUSTOMER_DOCUMENT_WORKORDER_NOT_FOUND") throw resourceNotFound("Workorder");
    if (error?.code === "CUSTOMER_DOCUMENT_SELLING_PRICE_REQUIRED") {
      conflict(error.code, "Every Workorder labor and part line must have an exact selling-price snapshot.");
    }
    throw error;
  }
  const { workorder } = actual;
  const lines = actual.parts.map((row) => {
    if (row.currency !== profile.defaultCurrency) conflict("CUSTOMER_DOCUMENT_CURRENCY_MISMATCH", "Workorder prices must use the profile currency.");
    return {
      id: `part-usage:${row.usageId}`,
      type: "part",
      description: row.description,
      quantity: row.quantity,
      unit: row.unit,
      unitPrice: row.unitPrice,
      manualOverride: row.manualOverride,
      discountEligible: true,
      ...taxEvidence(profile, "part"),
      source: { kind: `workorder_${row.sourceKind}`, id: row.usageId, priceVersionId: row.priceSnapshotId, pricingFingerprint: actual.pricingFingerprint },
    };
  });
  if (actual.labor) {
    if (actual.labor.currency !== profile.defaultCurrency) conflict("CUSTOMER_DOCUMENT_CURRENCY_MISMATCH", "Workorder prices must use the profile currency.");
    lines.unshift({
      id: "labor", type: "labor",
      description: actual.labor.description,
      quantity: actual.labor.hours, unit: actual.labor.uomCode || "hr", unitPrice: actual.labor.unitPrice,
      manualOverride: actual.labor.manualOverride, discountEligible: true,
      ...taxEvidence(profile, "labor"),
      source: { kind: "workorder_labor", id: actual.labor.productId, priceVersionId: actual.labor.id, pricingFingerprint: actual.pricingFingerprint },
    });
  }
  if (!lines.length) conflict("CUSTOMER_DOCUMENT_EMPTY_ESTIMATE", "Add priced labor or parts before previewing an Estimate.");
  const adjusted = applyAdjustments(lines, adjustments, context, profile);
  const formData = workorder.formData || {};
  return sourceProjection({
    source: { kind: "workorder", id: workorder.id, version: workorder.progressVersion, assetId: workorder.assetId },
    formData,
    concern: workorder.concern,
    repairDescription: workorder.workPerformed || workorder.diagnosis || "",
    unit: {
      id: workorder.assetId || null,
      label: workorder.asset?.unitNo || "Customer unit",
      vin: workorder.asset?.vin || null,
      make: workorder.asset?.make || null,
      model: workorder.asset?.model || null,
      year: workorder.asset?.year || null,
    },
    pricingFingerprint: actual.pricingFingerprint,
    documentType: dependencies.documentType || "estimate",
    basis: dependencies.documentType === "invoice" ? "actual" : "estimated",
    ...adjusted,
    profile,
  });
}

export function buildCustomerDocumentSource(context, source, adjustments, profile, dependencies = {}) {
  if (source.kind === "draft") return draftFinancialSource(context, source, adjustments, profile, dependencies);
  return workorderFinancialSource(context, source, adjustments, profile, dependencies);
}
