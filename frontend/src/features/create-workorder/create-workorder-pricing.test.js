import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createPricingPreferences,
  createPricingPreviewRequest,
  createPricingRequestKey,
  createPricingRequirements,
  createPricingSubmitPayload,
  normalizeCreatePricingPreview,
  selectedPricingIsComplete,
} from "./create-workorder-pricing.js";

test("create pricing request keeps only supported server-owned selection preferences", () => {
  const payload = {
    locationId: "location-1",
    pricing: {
      parts: [
        { partIndex: 0, selection: "batch_cost", unitPrice: "999", customUnitPrice: "12.75" },
        { partIndex: 1, selection: "invalid" },
      ],
      labor: { selection: "selling_price", amount: "999", customUnitPrice: "85" },
      expectedFingerprint: "stale",
    },
  };
  assert.deepEqual(createPricingPreferences(payload), {
    parts: [{ partIndex: 0, selection: "batch_cost", customUnitPrice: "12.75" }],
    labor: { selection: "selling_price", customUnitPrice: "85" },
  });
  assert.deepEqual(createPricingPreviewRequest(payload).pricing, createPricingPreferences(payload));
  assert.equal(
    createPricingRequestKey(payload),
    createPricingRequestKey({ ...payload, concern: "A non-pricing edit must not churn price preview." }),
  );
  assert.deepEqual(createPricingSubmitPayload(payload, "fresh"), {
    parts: [{ partIndex: 0, selection: "batch_cost", customUnitPrice: "12.75" }],
    labor: { selection: "selling_price", customUnitPrice: "85" },
    expectedFingerprint: "fresh",
  });
});

test("selected create prices are complete only with matching known server preview lines", () => {
  const payload = {
    formData: { laborHours: "2" },
    inventoryPositionSelections: [{ partIndex: 2, positionId: "position-1" }],
    pricing: { parts: [{ partIndex: 2, selection: "selling_price" }], labor: { selection: "internal_cost" } },
  };
  const known = normalizeCreatePricingPreview({
    fingerprint: "abc",
    parts: [{ partIndex: 2, status: "known", price: { unitPrice: "5", currency: "USD" } }],
    labor: { status: "known", price: { unitPrice: "75", currency: "USD" } },
    summary: { status: "complete" },
  });
  assert.equal(selectedPricingIsComplete(payload, known), true);
  assert.equal(selectedPricingIsComplete(payload, { ...known, fingerprint: "" }), false);
  assert.equal(selectedPricingIsComplete(payload, { ...known, parts: [{ partIndex: 2, status: "incomplete" }] }), false);
  assert.equal(selectedPricingIsComplete(payload, { ...known, labor: { status: "incomplete" } }), false);
  assert.equal(selectedPricingIsComplete({ ...payload, pricing: { parts: [], labor: payload.pricing.labor } }, known), false);
  assert.equal(selectedPricingIsComplete({ ...payload, pricing: { parts: payload.pricing.parts } }, known), false);
  assert.deepEqual(createPricingRequirements(payload), { partIndexes: [2], labor: true, hasPriceableRows: true });
  assert.deepEqual(createPricingRequirements({ formData: { laborHours: "0" } }), {
    partIndexes: [], labor: false, hasPriceableRows: false,
  });
  assert.equal(createPricingSubmitPayload({ pricing: { parts: [] } }, "abc"), null);
  assert.equal(createPricingSubmitPayload({ pricing: { parts: [{ partIndex: 2, selection: "selling_price", customUnitPrice: "1." }] } }, "abc"), null);
});

test("create pricing preview is create-only, debounced, cancellable, and latest-response safe", () => {
  const hook = readFileSync(new URL("./useCreateWorkorderPricing.js", import.meta.url), "utf8");
  const commands = readFileSync(new URL("../../app/routes/useRoleRouterCommands.js", import.meta.url), "utf8");
  assert.match(hook, /const enabled = active && \["admin", "office"\]\.includes\(actorRole\)/);
  assert.match(hook, /new AbortController\(\)/);
  assert.match(hook, /generation !== generationRef\.current/);
  assert.match(hook, /state\.requestKey !== requestKey \? "stale"/);
  assert.match(hook, /window\.setTimeout\(async \(\) =>/);
  assert.match(hook, /controller\.abort\(\)/);
  assert.match(hook, /const \[refreshVersion, setRefreshVersion\] = useState\(0\)/);
  assert.match(hook, /refreshVersion, requestKey/);
  assert.match(commands, /createPricing\?\.hasPriceableRows && !createPricing\.complete/);
  assert.match(commands, /error\?\.code === "WORKORDER_PRICING_CHANGED"/);
  assert.match(commands, /createPricing\?\.refresh\?\.\(\)/);
  assert.match(commands, /pricing: createPricing\.submitPricing/);
});
