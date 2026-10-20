import { useCallback, useEffect, useRef, useState } from "react";
import { SetRatesDialog } from "../pricing/SetRatesDialog.jsx";
import { api } from "../../lib/api.js";

export function LaborRatesDialog({ open, onClose, workorderId, locationId, productId, subjectLabel = "Labor", uomCode = "hr", onSaved }) {
  const retry = useRef(null);
  const generation = useRef(0);
  const [state, setState] = useState({ loading: true, error: "", rates: {} });
  const load = useCallback(async () => {
    const request = ++generation.current;
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const result = await api(`/api/labor-products/${encodeURIComponent(productId)}/rates?${new URLSearchParams({ locationId })}`);
      if (request === generation.current) setState({ loading: false, error: "", rates: result.currentRates || {} });
    } catch (error) {
      if (request === generation.current) setState((current) => ({ ...current, loading: false, error: error?.message || "Labor rates could not be loaded." }));
    }
  }, [productId, locationId]);
  useEffect(() => { if (open && productId && locationId) void load(); return () => { generation.current += 1; }; }, [open, productId, locationId, load]);
  async function save({ kind, amount, currency, reason }) {
    const rate = state.rates[kind];
    const command = {
      ...(workorderId ? { productId } : {}),
      locationId,
      priceKind: kind,
      expectedVersion: rate?.locationId === locationId ? Number(rate.version || 0) : 0,
      amount,
      currency,
      reason,
    };
    const signature = JSON.stringify(command);
    if (retry.current?.signature !== signature) retry.current = { signature, key: `labor-rate-${crypto.randomUUID()}` };
    const path = workorderId
      ? `/api/workorders/${encodeURIComponent(workorderId)}/modules/diagnosisRepair/actions/record`
      : `/api/labor-products/${encodeURIComponent(productId)}/rates`;
    await api(path, {
      method: workorderId ? "POST" : "PUT",
      body: JSON.stringify({ ...(workorderId ? { operation: "laborRateRevision" } : {}), ...command, idempotencyKey: retry.current.key }),
    });
    await onSaved?.();
  }
  return <SetRatesDialog open={open} onClose={onClose} subjectLabel={subjectLabel} uomCode={uomCode}
    scopeLabel="Workorder location" rates={state.rates} loading={state.loading} loadError={state.error} onRetry={load}
    allowedKinds={["internal_cost", "selling_price"]} onSave={save} disabled={!productId || !locationId} />;
}
