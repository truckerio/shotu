import { ChevronRight, SearchMd } from "@untitledui/icons";
import { textEntryProps } from "../../components/forms/text-entry-policy.js";
import {
  OperationalCollectionCell,
  OperationalCollectionResultHeader,
  OperationalCollectionRow,
  OperationalCollectionTable,
} from "../../components/operations/OperationalCollectionPage.jsx";
import { ProgressiveQueue } from "../../components/responsive/ProgressiveQueue.jsx";
import { progressiveQueueResetKey } from "../../components/responsive/ProgressiveQueue.js";
import { formatUiDate } from "../../lib/workorder-presentation.js";
import { inspectionActionForRole, inspectionMatchesSearch, inspectionResultLabel, inspectionStatusLabel } from "./inspection-model.js";
import "./inspections.css";

export function InspectionRow({ inspection, projection = "office", onOpen }) {
  const action = inspectionActionForRole(inspection, projection);
  const completed = inspection.status === "completed";
  const progress = inspection.progress || {};
  const status = inspectionStatusLabel(inspection.status);
  const result = inspection.result ? inspectionResultLabel(inspection.result) : "";
  const due = formatUiDate(inspection.dueAt);
  return (
    <OperationalCollectionRow
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

export function InspectionQueue({ inspections = [], projection = "office", projectionForInspection, search = "", onSearchChange, onOpen, emptyLabel = "No matching inspections" }) {
  const rows = inspections.filter((inspection) => inspectionMatchesSearch(inspection, search));
  const readOnly = projection === "read_only";
  return (
    <section className="inspection-queue" aria-label="Inspections">
      <div className="inspection-toolbar">
        <label className="inspection-search">
          <span className="inspection-field-label">Search inspections</span>
          <span className="inspection-search-control"><SearchMd aria-hidden="true" /><input {...textEntryProps("search")} value={search} onChange={(event) => onSearchChange?.(event.target.value)} placeholder={readOnly ? "Unit, VIN, plate, or inspection" : "Unit or inspection"} aria-label="Search inspections" /></span>
        </label>
      </div>
      <OperationalCollectionResultHeader><span><strong>{rows.length}</strong> inspection{rows.length === 1 ? "" : "s"}</span></OperationalCollectionResultHeader>
      {rows.length ? (
        <OperationalCollectionTable className="inspection-table" ariaLabel="Inspections" columns={[
          { id: "identity", label: "Unit / inspection" },
          { id: "location", label: "Location" },
          { id: "assignee", label: "Assigned to" },
          { id: "status", label: "Status" },
          { id: "progress", label: "Due / progress" },
          { id: "action", label: "Action" },
        ]}>
          <ProgressiveQueue
            items={rows}
            resetKey={progressiveQueueResetKey([projection, search])}
            renderItem={(inspection) => <InspectionRow inspection={inspection} projection={projectionForInspection?.(inspection) || projection} onOpen={onOpen} />}
          />
        </OperationalCollectionTable>
      ) : <div className="inspection-empty"><strong>{emptyLabel}</strong><span>{search ? "Try a different unit or inspection number." : "Inspections will appear here when they are requested."}</span></div>}
    </section>
  );
}
