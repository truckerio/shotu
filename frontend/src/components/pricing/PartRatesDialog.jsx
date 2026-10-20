import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api.js";
import { locationPriceEditState, pricePayload } from "../../features/inventory/part-commercial-model.js";
import { SetRatesDialog } from "./SetRatesDialog.jsx";
import { editablePartRateKinds, notifyRateSaved, partRatePaths, rateSourceLabel, retryCommand, sellingRateDraft } from "./set-rates-model.js";

const newKey = (type) => `${type}-${crypto.randomUUID()}`;

export function PartRatesDialog({ open, onClose, catalogPartId, locationId, partLabel, uomCode, initialKind, onSaved, readOnly = false }) {
  const [state, setState] = useState({ loading: false, error: "", commercial: null, selling: null });
  const requestSequence = useRef(0);
  const retries = useRef(new Map());

  const load = useCallback(async () => {
    if (!open || !catalogPartId) return;
    const request = ++requestSequence.current;
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const paths = partRatePaths(catalogPartId, locationId);
      const [commercial, selling] = await Promise.all([
        api(paths.commercial),
        api(paths.selling),
      ]);
      if (request === requestSequence.current) setState({ loading: false, error: "", commercial, selling });
    } catch (failure) {
      if (request === requestSequence.current) setState((current) => ({ ...current, loading: false, error: failure.message || "Rates could not be loaded." }));
    }
  }, [open, catalogPartId, locationId]);

  useEffect(() => {
    if (open) load();
    return () => { requestSequence.current += 1; };
  }, [open, load]);

  const projection = state.commercial?.prices?.internal;
  const internalState = locationId
    ? locationPriceEditState(projection)
    : { draft: projection?.current || null, effective: projection?.current || null, expectedVersion: Number(projection?.current?.version || 0), source: projection?.current ? "company_default" : null };
  const sellingPolicy = state.selling?.policy || null;
  const sellingSource = sellingPolicy ? (locationId && sellingPolicy.locationId === locationId ? "location_override" : "company_default") : null;
  const allowedKinds = editablePartRateKinds({ readOnly, commercialCapabilities: state.commercial?.capabilities, sellingCapabilities: state.selling?.capabilities });
  const canEditInternal = allowedKinds.includes("internal_cost");
  const canEditSelling = allowedKinds.includes("selling_price");
  const trackingMode = state.commercial?.part?.trackingMode;
  const sellingDraft = sellingRateDraft(sellingPolicy, trackingMode, internalState.effective?.currency);
  const rates = useMemo(() => ({
    internal_cost: {
      amount: internalState.draft?.amount ?? internalState.effective?.amount ?? "",
      currency: internalState.draft?.currency || internalState.effective?.currency || sellingPolicy?.currency || "USD",
      sourceLabel: rateSourceLabel(internalState.source, Boolean(locationId)),
    },
    selling_price: {
      ...sellingDraft,
      sourceLabel: rateSourceLabel(sellingSource, Boolean(locationId)),
    },
  }), [
    internalState.draft?.amount,
    internalState.draft?.currency,
    internalState.effective?.amount,
    internalState.effective?.currency,
    internalState.source,
    sellingDraft.amount,
    sellingDraft.currency,
    sellingDraft.method,
    sellingSource,
    locationId,
  ]);

  function stableKey(kind, payload) {
    const signature = JSON.stringify(payload);
    const next = retryCommand(retries.current.get(kind), signature, () => newKey(kind === "internal_cost" ? "configured-cost" : "selling-policy"));
    retries.current.set(kind, next);
    return next.key;
  }

  async function save({ kind, amount, currency, reason, method }) {
    const paths = partRatePaths(catalogPartId, locationId);
    if (kind === "internal_cost") {
      if (!canEditInternal) throw new Error("You do not have permission to change the internal price in this scope.");
      const basis = internalState.draft || internalState.effective;
      const payload = pricePayload({
        amount,
        currency,
        taxTreatment: basis?.taxTreatment || "not_configured",
        taxProfileVersionId: basis?.taxProfileVersionId || null,
        reason,
        expectedVersion: internalState.expectedVersion,
      });
      delete payload.idempotencyKey;
      await api(paths.internal, {
        method: "PUT",
        body: JSON.stringify({ ...payload, idempotencyKey: stableKey(kind, payload) }),
      });
    } else {
      if (!canEditSelling) throw new Error("You do not have permission to change the selling price in this scope.");
      const payload = { expectedVersion: Number(state.selling?.writeVersion || 0), method, value: amount, currency: method === "markup_percent" ? null : currency, reason };
      await api(paths.selling, { method: "PUT", body: JSON.stringify({ ...payload, idempotencyKey: stableKey(kind, payload) }) });
    }
    retries.current.delete(kind);
    await notifyRateSaved(onSaved);
  }

  const scopeName = locationId
    ? state.commercial?.scope?.locationName || "Location rates"
    : "Company default rates";
  return <SetRatesDialog
    open={open}
    onClose={onClose}
    subjectLabel={partLabel}
    uomCode={uomCode || state.commercial?.part?.uomCode}
    scopeLabel={scopeName}
    initialKind={initialKind}
    rates={rates}
    allowedKinds={allowedKinds}
    allowSellingMethods={trackingMode !== "no_stock"}
    onSave={save}
    disabled={readOnly}
    loading={state.loading}
    loadError={state.error}
    onRetry={load}
  />;
}
