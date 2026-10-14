import { ChevronRight, FilterLines, SearchMd } from "@untitledui/icons";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { normalizeInspectionFilters } from "./inspection-session-state.js";
import { textEntryProps } from "../../components/forms/text-entry-policy.js";
import {
  OperationalCollectionCell,
  OperationalCollectionResultHeader,
  OperationalCollectionRow,
} from "../../components/operations/OperationalCollectionPage.jsx";
import { CheckpointCollection } from "../../components/ui/CheckpointCollection.jsx";
import { formatUiDate } from "../../lib/workorder-presentation.js";
import { inspectionActionForRole, inspectionResultLabel, inspectionStatusLabel } from "./inspection-model.js";
import "./inspections.css";
import "../../components/operations/operations.css";

export function InspectionRow({ inspection, projection = "office", onOpen, ...rowProps }) {
  const action = inspectionActionForRole(inspection, projection);
  const completed = inspection.status === "completed";
  const progress = inspection.progress || {};
  const status = inspectionStatusLabel(inspection.status);
  const result = inspection.result ? inspectionResultLabel(inspection.result) : "";
  const due = formatUiDate(inspection.dueAt);
  return (
    <OperationalCollectionRow
      {...rowProps}
      className="inspection-row"
      ariaLabel={`${inspection.number || "Inspection"}, ${inspection.unitNo || "Unit not recorded"}, ${status}`}
      onAction={() => onOpen?.(inspection)}
    >
      <OperationalCollectionCell className="inspection-cell inspection-identity" label="Unit / inspection">
        <strong>{inspection.unitNo || "Unit not recorded"}</strong>
        <span>{inspection.number || "Inspection"} · {inspection.templateLabel || "Weekly inspection"}</span>
      </OperationalCollectionCell>
      <OperationalCollectionCell className="inspection-cell inspection-location" label="Location">
        <strong>{inspection.locationName || "Not recorded"}</strong>
      </OperationalCollectionCell>
      <OperationalCollectionCell className="inspection-cell inspection-assignee" label="Assigned to">
        <strong className={inspection.mechanicName ? "" : "is-unassigned"}>{inspection.mechanicName || "Unassigned"}</strong>
      </OperationalCollectionCell>
      <OperationalCollectionCell className="inspection-cell inspection-state" label="Status">
        <span className={`inspection-status is-${inspection.status || "unknown"}`}>{status}</span>
        {result ? <span className={`inspection-result is-${inspection.result}`}>{result}</span> : null}
      </OperationalCollectionCell>
      <OperationalCollectionCell className="inspection-cell inspection-progress-cell" label={completed ? "Completed" : "Due / progress"}>
        {completed ? <strong>{formatUiDate(inspection.completedAt) || "Completed"}</strong> : <>
          <strong>{progress.answered || 0} / {progress.total || 12} checked</strong>
          <span>{due ? `Due ${due}` : `${progress.issues || 0} issue${progress.issues === 1 ? "" : "s"}`}</span>
        </>}
      </OperationalCollectionCell>
      <OperationalCollectionCell className="inspection-cell inspection-action" label="Action">
        <span>{action}</span><ChevronRight aria-hidden="true" />
      </OperationalCollectionCell>
    </OperationalCollectionRow>
  );
}

function InspectionFilterPopover({ label, active, compact = false, children }) {
  return <DialogTrigger>
    <Button className={`operations-filter-trigger ${compact ? "inspection-compact-filter" : "is-column"}${active ? " is-active" : ""}`} aria-label={`${label} filters and sort`}><span>{label}</span><FilterLines aria-hidden="true" /></Button>
    <Popover className="operations-filter-popover inspection-filter-popover" placement="bottom end" offset={8}>
      <Dialog aria-label={`${label} filters and sort`}>{({ close }) => <>
        <header><h3>{label}</h3><Button onPress={close}>Done</Button></header>
        <div className="operations-filter-fields">{children}</div>
      </>}</Dialog>
    </Popover>
  </DialogTrigger>;
}

export function InspectionQueue({ queue, projection = "office", projectionForInspection, search = "", onSearchChange, status = "not_completed", onStatusChange, filters: filterInput, onFiltersChange, filterOptions = {}, onOpen, emptyLabel = "No matching inspections" }) {
  const readOnly = projection === "read_only";
  const filters = normalizeInspectionFilters(filterInput);
  const filtered = Boolean(filters.locationId || filters.mechanicId || filters.unitType || filters.result || filters.sort !== "updated_desc");
  const update = (key, value) => onFiltersChange?.({ ...filters, [key]: value, ...(key === "locationId" ? { mechanicId: "" } : {}) });
  const mechanicOptions = (filterOptions.mechanics || []).filter(mechanic => !filters.locationId || mechanic.locationIds.includes(filters.locationId));
  const fields = {
    location: <label><span className="inspection-field-label">Location</span><Dropdown aria-label="Location" disabled={filterOptions.loading} value={filters.locationId} onChange={(event) => update("locationId", event.target.value)}><option value="">All locations</option>{filters.locationId && !(filterOptions.locations || []).some(location => location.id === filters.locationId) ? <option value={filters.locationId}>Selected location unavailable</option> : null}{(filterOptions.locations || []).map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</Dropdown></label>,
    mechanic: <label><span className="inspection-field-label">Mechanic</span><Dropdown aria-label="Mechanic" disabled={filterOptions.loading} value={filters.mechanicId} onChange={(event) => update("mechanicId", event.target.value)}><option value="">All mechanics</option>{filters.mechanicId && !mechanicOptions.some(mechanic => mechanic.id === filters.mechanicId) ? <option value={filters.mechanicId}>Selected mechanic unavailable</option> : null}{mechanicOptions.map(mechanic => <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}</Dropdown></label>,
    unit: <label><span className="inspection-field-label">Unit type</span><Dropdown aria-label="Unit type" value={filters.unitType} onChange={(event) => update("unitType", event.target.value)}><option value="">All units</option><option value="Truck">Trucks</option><option value="Trailer">Trailers</option></Dropdown></label>,
    result: <label><span className="inspection-field-label">Result</span><Dropdown aria-label="Result" value={filters.result} onChange={(event) => update("result", event.target.value)}><option value="">All results</option><option value="passed">Passed</option><option value="issues_found">Issues found</option><option value="out_of_service">Out of service</option></Dropdown></label>,
    sort: <label><span className="inspection-field-label">Sort</span><Dropdown aria-label="Sort" value={filters.sort} onChange={(event) => update("sort", event.target.value)}><option value="updated_desc">Newest activity</option><option value="updated_asc">Oldest activity</option></Dropdown></label>,
  };
  return (
    <section className="inspection-queue" aria-label="Inspections">
      <div className="inspection-toolbar">
        <label className="inspection-queue-field">
          <span className="inspection-field-label">Queue</span>
          <Dropdown aria-label="Queue" value={status} onChange={(event) => onStatusChange?.(event.target.value)}>
            {readOnly ? <option value="">All</option> : null}
            <option value="not_completed">Active</option>
            {projection === "office" || projection === "admin" ? <option value="needs_action">Needs action</option> : null}
            {projection === "office" || projection === "admin" ? <option value="in_progress">In progress</option> : null}
            <option value="completed">Completed</option>
          </Dropdown>
        </label>
        <label className="inspection-search">
          <span className="inspection-field-label">Search inspections</span>
          <span className="inspection-search-control"><SearchMd aria-hidden="true" /><input {...textEntryProps("search")} value={search} onChange={(event) => onSearchChange?.(event.target.value)} placeholder={readOnly ? "Unit, VIN, plate, or inspection" : "Unit or inspection"} aria-label="Search inspections" /></span>
        </label>
        <InspectionFilterPopover compact label="Filter and sort" active={filtered}>{Object.entries(fields).map(([key, field]) => <div key={key}>{field}</div>)}</InspectionFilterPopover>
      </div>
      {filterOptions.error ? <p role="alert">Filter options unavailable: {filterOptions.error}</p> : null}
      <OperationalCollectionResultHeader><span><strong>{queue.total}</strong> inspection{queue.total === 1 ? "" : "s"}</span>{filtered ? <Button onPress={() => onFiltersChange?.(normalizeInspectionFilters())}>Clear filters</Button> : null}</OperationalCollectionResultHeader>
        <CheckpointCollection queue={queue} label="inspections" pageSize={20} storageKey={queue.storageKey} className="inspection-table" ariaLabel="Inspections" columns={[
          { id: "identity", label: <InspectionFilterPopover label="Unit / inspection" active={Boolean(filters.unitType)}>{fields.unit}</InspectionFilterPopover> },
          { id: "location", label: <InspectionFilterPopover label="Location" active={Boolean(filters.locationId)}>{fields.location}</InspectionFilterPopover> },
          { id: "assignee", label: <InspectionFilterPopover label="Mechanic" active={Boolean(filters.mechanicId)}>{fields.mechanic}</InspectionFilterPopover> },
          { id: "status", label: <InspectionFilterPopover label="Status" active={Boolean(filters.result)}>{fields.result}</InspectionFilterPopover> },
          { id: "progress", label: <InspectionFilterPopover label="Due / progress" active={filters.sort !== "updated_desc"}>{fields.sort}</InspectionFilterPopover> },
          { id: "action", label: "Action" },
        ]} renderItem={(inspection) => <InspectionRow inspection={inspection} projection={projectionForInspection?.(inspection) || projection} onOpen={onOpen} />}>
          <div className="inspection-empty"><strong>{emptyLabel}</strong><span>Change or clear filters to see more inspections.</span></div>
        </CheckpointCollection>
    </section>
  );
}
