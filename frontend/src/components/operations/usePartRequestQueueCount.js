import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { buildPartRequestsQuery } from "./operations-format.js";

const CANONICAL_QUEUE_FILTERS = Object.freeze({
  locationId: "",
  search: "",
  status: "",
  supply: "",
  sort: "waiting:desc",
});

export function usePartRequestQueueCount({ locationId = "", refreshKey = 0, enabled = true } = {}) {
  const [result, setResult] = useState({ total: null, loading: true, loaded: false, error: "" });

  useEffect(() => {
    if (!enabled) { setResult({ total: 0, loading: false, loaded: false, error: "" }); return undefined; }
    const controller = new AbortController();
    const params = buildPartRequestsQuery({ ...CANONICAL_QUEUE_FILTERS, locationId }, 1, 1);
    setResult((current) => ({ ...current, loading: true, error: "" }));
    api(`/api/office/part-requests/queue?${params}`, { signal: controller.signal })
      .then((response) => setResult({
        total: Number(response.total) || 0,
        loading: false,
        loaded: true,
        error: "",
      }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setResult((current) => ({ ...current, loading: false, loaded: false, error: error.message }));
        }
      });
    return () => controller.abort();
  }, [enabled, locationId, refreshKey]);

  return result;
}
