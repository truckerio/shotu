import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { formatLifecycleLabel } from "../../lib/workorder-presentation.js";

const TERMINAL_LIFECYCLES = new Set(["mechanic_done", "closed", "odoo_entered", "cancelled"]);

export function WorkorderActivityStatus({ controller, lifecycleStatus = "", lifecycleLabel = "" }) {
  const view = controller.view;
  const terminal = TERMINAL_LIFECYCLES.has(lifecycleStatus);
  const terminalValue = `lifecycle:${lifecycleStatus}`;
  const terminalText = lifecycleLabel || formatLifecycleLabel(lifecycleStatus);
  if (!controller.ready && !terminal) {
    return <span className="workorder-activity-status is-loading" role="status">Status…</span>;
  }
  if (!view) return <div className="workorder-activity-status">
    <Dropdown aria-label="Workorder status" value={terminal ? terminalValue : "unavailable"} disabled><option value={terminal ? terminalValue : "unavailable"}>{terminal ? terminalText : "Unavailable"}</option></Dropdown>
    <button type="button" className="workorder-status-retry" onClick={controller.refresh} disabled={controller.busy}>Retry</button>
    <span className="workorder-status-error" role="alert">{controller.error || "Workorder status is unavailable."}</span>
  </div>;
  const displayedStatus = terminal ? terminalValue : view.activityStatus;
  const displayedOptions = terminal ? [{ value: displayedStatus, label: terminalText }] : view.statusOptions;
  return (
    <div className="workorder-activity-status">
      <Dropdown
        aria-label="Workorder status"
        value={displayedStatus}
        disabled={terminal || !view.canChangeStatus || controller.busy}
        onChange={(event) => { void controller.changeStatus(event.target.value).catch(() => {}); }}
      >
        {displayedOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Dropdown>
      {controller.error ? <button type="button" className="workorder-status-retry" onClick={controller.refresh} disabled={controller.busy}>Retry</button> : null}
      {controller.error ? <span className="workorder-status-error" role="alert">{controller.error}</span> : null}
    </div>
  );
}
