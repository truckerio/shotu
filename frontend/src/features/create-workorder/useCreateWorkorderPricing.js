import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api.js";
import {
  createPricingPreviewRequest,
  createPricingRequestKey,
  createPricingRequirements,
  createPricingSubmitPayload,
  normalizeCreatePricingPreview,
  selectedPricingIsComplete,
} from "./create-workorder-pricing.js";

const PREVIEW_DEBOUNCE_MS = 300;

export function useCreateWorkorderPricing({ active = true, actorRole, payload }) {
  const enabled = active && ["admin", "office"].includes(actorRole);
  const request = useMemo(() => createPricingPreviewRequest(payload), [payload]);
  const requestKey = useMemo(() => createPricingRequestKey(payload), [payload]);
  const requirements = useMemo(() => createPricingRequirements(payload), [payload]);
  const generationRef = useRef(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [state, setState] = useState({ status: "idle", preview: null, message: "" });

  useEffect(() => {
    if (!enabled || !request.locationId) {
      generationRef.current += 1;
      setState({ status: "idle", preview: null, message: "" });
      return undefined;
    }

    const generation = ++generationRef.current;
    const controller = new AbortController();
    setState((current) => ({
      status: current.preview ? "stale" : "loading",
      preview: current.preview,
      message: "Updating prices…",
    }));
    const timer = window.setTimeout(async () => {
      try {
        const result = await api("/api/workorders/create-pricing-preview", {
          method: "POST",
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (controller.signal.aborted || generation !== generationRef.current) return;
        const preview = normalizeCreatePricingPreview(result);
        setState({ status: "ready", preview, message: "", requestKey });
      } catch (error) {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        setState({ status: "error", preview: null, message: error?.message || "Prices could not be previewed.", requestKey });
      }
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, refreshVersion, requestKey]);

  const hasSelections = request.pricing.parts.length > 0 || Boolean(request.pricing.labor);
  const status = state.status === "ready" && state.requestKey !== requestKey ? "stale" : state.status;
  const complete = !requirements.hasPriceableRows
    || (enabled && status === "ready" && selectedPricingIsComplete(payload, state.preview));
  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);
  return {
    ...state,
    status,
    enabled,
    hasSelections,
    hasPriceableRows: requirements.hasPriceableRows,
    complete,
    refresh,
    submitPricing: complete ? createPricingSubmitPayload(payload, state.preview?.fingerprint) : null,
  };
}
