import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.js";
import { useCheckpointPages } from "../../components/operations/useCheckpointPages.js";
import { readCheckpointPosition } from "../../components/operations/checkpoint-position.js";
import { inspectionBatchQuery, inspectionFromApi } from "./inspection-api-model.js";

export function useInspectionQueue({ actorId, projection, status, search, filters }) {
  const [querySearch, setQuerySearch] = useState(search);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuerySearch(search), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [search]);
  const storageKey = JSON.stringify(["inspection-batches", actorId, projection, status, querySearch, filters]);
  const initialPage = useMemo(() => readCheckpointPosition(storageKey)?.page || 1, [storageKey]);
  const fetchPage = useCallback(async (page, { signal }) => {
    const result = await api(`/api/inspections?${inspectionBatchQuery({ status, search: querySearch, filters }, page)}`, { signal });
    return { ...result, items: (result.items || []).map(inspectionFromApi) };
  }, [status, querySearch, filters]);
  const queue = useCheckpointPages({ queryKey: storageKey, fetchPage, initialPage });
  return { ...queue, storageKey };
}
