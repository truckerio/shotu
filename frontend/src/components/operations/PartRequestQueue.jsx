import { Dropdown } from "../forms/Dropdown.jsx";
import { useEffect, useState } from "react";
import { SearchMd } from "@untitledui/icons";
import { api } from "../../lib/api.js";
import { textEntryProps } from "../forms/text-entry-policy.js";
import { Pagination } from "../ui/Pagination.jsx";
import {
  PART_REQUEST_SORT_OPTIONS,
  PART_REQUEST_STATUS_OPTIONS,
  PART_REQUEST_SUPPLY_OPTIONS,
  buildPartRequestsQuery,
  formatActivity,
  formatDuration,
} from "./operations-format.js";
import { clampPartRequestPage, partRequestRowModel } from "./part-request-queue-model.js";
import "./operations.css";

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
    <div className="part-request-queue-row" role="row">
      <div className="part-request-queue-cell part-request-queue-part" role="cell" data-label="Part">
        {interactive ? (
          <button type="button" className="part-request-queue-open" onClick={open} aria-label={`Open ${partIdentity} request for ${row.workorderLabel}, ${row.unitLabel}`}>
            <strong>{row.partNumber || row.partDescription}</strong>
            {row.partNumber && row.partDescription ? <span>{row.partDescription}</span> : null}
            <span>{row.quantity} {row.unit}</span>
          </button>
        ) : <><strong>{row.partNumber || row.partDescription}</strong>{row.partNumber && row.partDescription ? <span>{row.partDescription}</span> : null}<span>{row.quantity} {row.unit}</span></>}
      </div>
      <div className="part-request-queue-cell" role="cell" data-label="Workorder / unit">
        <strong>{row.workorderLabel}</strong>
        <span>{row.unitLabel}</span>
      </div>
      <div className="part-request-queue-cell" role="cell" data-label="Destination">{row.destination}</div>
      <div className="part-request-queue-cell" role="cell" data-label="Requester">{row.requester}</div>
      <div className="part-request-queue-cell" role="cell" data-label="Supply">
        <span className="part-request-queue-supply">{row.supply}</span>
      </div>
      <div className="part-request-queue-cell part-request-queue-state" role="cell" data-label="Status / next action">
        <span className="part-request-queue-status">{row.status}</span>
        <span>{row.nextAction}</span>
      </div>
      <div className="part-request-queue-cell part-request-queue-activity" role="cell" data-label="Waiting / activity" title={activity.absolute}>
        <strong>{waiting}</strong>
        <span>{activity.relative}</span>
      </div>
    </div>
  );
}

function LoadingRows() {
  return <div className="part-request-queue-loading" role="status" aria-label="Loading part requests">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div>;
}

export function PartRequestQueue({
  filters,
  locations = [],
  fixedLocationId = "",
  onFiltersChange,
  onOpenWorkorder,
  refreshKey = 0,
}) {
  const [page, setPage] = useState(1);
  const [retryKey, setRetryKey] = useState(0);
  const [result, setResult] = useState({ items: [], total: 0, pageCount: 1, loading: true, error: "" });

  useEffect(() => setPage(1), [filters.locationId, filters.search, filters.status, filters.supply, filters.sort]);

  useEffect(() => {
    const controller = new AbortController();
    setResult((current) => ({ ...current, loading: true, error: "" }));
    const params = buildPartRequestsQuery(filters, page);
    api(`/api/office/part-requests/queue?${params}`, { signal: controller.signal })
      .then((next) => {
        const resolved = {
          items: Array.isArray(next.items) ? next.items : [],
          total: Number(next.total) || 0,
          pageCount: Math.max(1, Number(next.pageCount) || Math.ceil((Number(next.total) || 0) / (Number(next.pageSize) || 50))),
          loading: false,
          error: "",
        };
        const validPage = clampPartRequestPage(page, resolved.pageCount);
        if (validPage !== page) {
          setPage(validPage);
          return;
        }
        setResult(resolved);
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setResult((current) => ({ ...current, loading: false, error: error.message }));
      });
    return () => controller.abort();
  }, [filters.locationId, filters.search, filters.status, filters.supply, filters.sort, page, refreshKey, retryKey]);

  function updateFilter(key, value) {
    onFiltersChange(key, value);
  }

  return (
    <div className="part-request-queue">
      <div className="part-request-queue-toolbar">
        <label className="part-request-queue-search">
          <span className="operations-field-label">Search part requests</span>
          <span className="operations-input-with-icon"><SearchMd /><input {...textEntryProps("search")} type="search" value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Part, workorder, unit" /></span>
        </label>
        {!fixedLocationId ? <label><span className="operations-field-label">Location</span><Dropdown value={filters.locationId} onChange={(event) => updateFilter("locationId", event.target.value)}><option value="">All locations</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</Dropdown></label> : null}
        <label><span className="operations-field-label">Status</span><Dropdown value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>{PART_REQUEST_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Dropdown></label>
        <label><span className="operations-field-label">Supply</span><Dropdown value={filters.supply} onChange={(event) => updateFilter("supply", event.target.value)}>{PART_REQUEST_SUPPLY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Dropdown></label>
        <label><span className="operations-field-label">Sort</span><Dropdown value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value)}>{PART_REQUEST_SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Dropdown></label>
      </div>
      <div className="part-request-queue-table" role="table" aria-label="Part requests" aria-busy={result.loading}>
        <div className="part-request-queue-head" role="row"><span role="columnheader">Part</span><span role="columnheader">Workorder / unit</span><span role="columnheader">Destination</span><span role="columnheader">Requester</span><span role="columnheader">Supply</span><span role="columnheader">Status / next action</span><span role="columnheader">Waiting / activity</span></div>
        {result.loading ? <LoadingRows /> : null}
        {!result.loading && result.error ? <div className="operations-state-message error" role="alert"><strong>Part requests could not be loaded.</strong><span>{result.error}</span><button type="button" onClick={() => setRetryKey((current) => current + 1)}>Try again</button></div> : null}
        {!result.loading && !result.error && !result.items.length ? <div className="operations-state-message"><strong>No part requests match these filters.</strong></div> : null}
        {!result.loading && !result.error ? result.items.map((request) => <PartRequestRow key={request.id} request={request} onOpenWorkorder={onOpenWorkorder} />) : null}
      </div>
      <Pagination currentPage={page} pageCount={result.pageCount} setPage={setPage} total={result.total} label="part requests" loading={result.loading} />
    </div>
  );
}
