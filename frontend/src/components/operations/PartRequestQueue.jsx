import { Dropdown } from "../forms/Dropdown.jsx";
import { useCallback, useMemo } from "react";
import { SearchMd } from "@untitledui/icons";
import { api } from "../../lib/api.js";
import { textEntryProps } from "../forms/text-entry-policy.js";
import { CheckpointCollection } from "../ui/CheckpointCollection.jsx";
import { readCheckpointPosition, saveCheckpointPosition } from "./checkpoint-position.js";
import { useCheckpointPages } from "./useCheckpointPages.js";
import {
  PART_REQUEST_SORT_OPTIONS,
  PART_REQUEST_STATUS_OPTIONS,
  PART_REQUEST_SUPPLY_OPTIONS,
  buildPartRequestsQuery,
  formatActivity,
  formatDuration,
} from "./operations-format.js";
import { partRequestRowModel } from "./part-request-queue-model.js";
import {
  OperationalCollectionCell,
  OperationalCollectionRow,
  OperationalCollectionToolbar,
} from "./OperationalCollectionPage.jsx";
import "./operations.css";

const PART_REQUEST_COLUMNS = [
  { id: "part", label: "Part" },
  { id: "workorder", label: "Workorder / unit" },
  { id: "destination", label: "Destination" },
  { id: "requester", label: "Requester" },
  { id: "supply", label: "Supply" },
  { id: "status", label: "Status / next action" },
  { id: "activity", label: "Waiting / activity" },
];

function partRequestStorageKey(filters, fixedLocationId) {
  return `part-request-queue:${JSON.stringify([
    fixedLocationId,
    filters.locationId,
    filters.search,
    filters.status,
    filters.supply,
    filters.sort,
  ])}`;
}

function PartRequestRow({ request, onOpenWorkorder }) {
  const row = partRequestRowModel(request);
  const waiting = formatDuration(row.waitingSeconds);
  const activity = formatActivity(row.lastActivityAt);
  const partIdentity = [row.partNumber, row.partDescription].filter(Boolean).join(" · ");
  const interactive = Boolean(row.workorderId && typeof onOpenWorkorder === "function");

  function open() {
    if (interactive) onOpenWorkorder(row.workorderId, { partRequestId: request.id });
  }

  return (
    <OperationalCollectionRow className="part-request-queue-row">
      <OperationalCollectionCell className="part-request-queue-cell part-request-queue-part" label="Part">
        {interactive ? (
          <button type="button" className="part-request-queue-open" onClick={open} aria-label={`Open ${partIdentity} request for ${row.workorderLabel}, ${row.unitLabel}`}>
            <strong>{row.partNumber || row.partDescription}</strong>
            {row.partNumber && row.partDescription ? <span>{row.partDescription}</span> : null}
            <span>{row.quantity} {row.unit}</span>
          </button>
        ) : <><strong>{row.partNumber || row.partDescription}</strong>{row.partNumber && row.partDescription ? <span>{row.partDescription}</span> : null}<span>{row.quantity} {row.unit}</span></>}
      </OperationalCollectionCell>
      <OperationalCollectionCell className="part-request-queue-cell" label="Workorder / unit">
        <strong>{row.workorderLabel}</strong>
        <span>{row.unitLabel}</span>
      </OperationalCollectionCell>
      <OperationalCollectionCell className="part-request-queue-cell" label="Destination">{row.destination}</OperationalCollectionCell>
      <OperationalCollectionCell className="part-request-queue-cell" label="Requester">{row.requester}</OperationalCollectionCell>
      <OperationalCollectionCell className="part-request-queue-cell" label="Supply">
        <span className="part-request-queue-supply">{row.supply}</span>
      </OperationalCollectionCell>
      <OperationalCollectionCell className="part-request-queue-cell part-request-queue-state" label="Status / next action">
        <span className="part-request-queue-status">{row.status}</span>
        <span>{row.nextAction}</span>
      </OperationalCollectionCell>
      <OperationalCollectionCell className="part-request-queue-cell part-request-queue-activity" label="Waiting / activity">
        <strong>{waiting}</strong>
        <span title={activity.absolute}>{activity.relative}</span>
      </OperationalCollectionCell>
    </OperationalCollectionRow>
  );
}

export function PartRequestQueue({
  filters,
  locations = [],
  fixedLocationId = "",
  onFiltersChange,
  onOpenWorkorder,
  refreshKey = 0,
}) {
  const queryKey = useMemo(() => JSON.stringify([
    fixedLocationId,
    filters.locationId,
    filters.search,
    filters.status,
    filters.supply,
    filters.sort,
  ]), [filters.locationId, filters.search, filters.sort, filters.status, filters.supply, fixedLocationId]);
  const storageKey = partRequestStorageKey(filters, fixedLocationId);
  const initialPage = readCheckpointPosition(storageKey)?.page || 1;
  const fetchPage = useCallback(async (page, { signal }) => {
    const params = buildPartRequestsQuery(filters, page);
    const next = await api(`/api/office/part-requests/queue?${params}`, { signal });
    return {
      items: Array.isArray(next.items) ? next.items : [],
      total: Number(next.total) || 0,
      pageCount: Math.max(1, Number(next.pageCount) || Math.ceil((Number(next.total) || 0) / (Number(next.pageSize) || 50))),
      page,
    };
  }, [filters]);
  const requestQueue = useCheckpointPages({
    queryKey,
    fetchPage,
    initialPage,
    refreshKey,
    getItemKey: (request) => request.id,
  });

  function updateFilter(key, value) {
    saveCheckpointPosition(partRequestStorageKey({ ...filters, [key]: value }, fixedLocationId), { page: 1 });
    onFiltersChange(key, value);
  }

  return (
    <div className="part-request-queue">
      <OperationalCollectionToolbar className="operations-toolbar part-request-queue-toolbar">
        <label className="part-request-queue-search">
          <span className="operations-field-label">Search part requests</span>
          <span className="operations-input-with-icon"><SearchMd /><input {...textEntryProps("search")} type="search" value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Part, workorder, unit" /></span>
        </label>
        {!fixedLocationId ? <label><span className="operations-field-label">Location</span><Dropdown value={filters.locationId} onChange={(event) => updateFilter("locationId", event.target.value)}><option value="">All locations</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</Dropdown></label> : null}
        <label><span className="operations-field-label">Status</span><Dropdown value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>{PART_REQUEST_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Dropdown></label>
        <label><span className="operations-field-label">Supply</span><Dropdown value={filters.supply} onChange={(event) => updateFilter("supply", event.target.value)}>{PART_REQUEST_SUPPLY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Dropdown></label>
        <label><span className="operations-field-label">Sort</span><Dropdown value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value)}>{PART_REQUEST_SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Dropdown></label>
      </OperationalCollectionToolbar>
      <CheckpointCollection
        queue={requestQueue}
        columns={PART_REQUEST_COLUMNS}
        renderItem={(request) => <PartRequestRow request={request} onOpenWorkorder={onOpenWorkorder} />}
        className="part-request-queue-table"
        ariaLabel="Part requests"
        label="part requests"
        pageSize={50}
        storageKey={storageKey}
        getItemKey={(request) => request.id}
      >
        <div className="operations-state-message"><strong>No part requests match these filters.</strong></div>
      </CheckpointCollection>
    </div>
  );
}
