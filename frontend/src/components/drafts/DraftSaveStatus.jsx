import { AlertCircle, CheckCircle, Clock, RefreshCw01 } from "@untitledui/icons";
import "./drafts.css";

const STATUS_CONTENT = {
  pristine: { icon: Clock, label: "Not saved yet" },
  dirty: { icon: Clock, label: "Unsaved changes" },
  saving: { icon: RefreshCw01, label: "Saving draft..." },
  saved: { icon: CheckCircle, label: "Draft saved" },
  error: { icon: AlertCircle, label: "Draft could not be saved" },
};

export function DraftSaveStatus({
  status,
  error = null,
  showPristine = false,
  iconOnly = false,
  labels = {},
  className = "",
}) {
  if (status === "pristine" && !showPristine) return null;

  const content = STATUS_CONTENT[status] || STATUS_CONTENT.pristine;
  const Icon = content.icon;
  const errorMessage = error instanceof Error ? error.message : error;
  const label = labels[status] || (status === "error" && errorMessage) || content.label;

  return (
    <span
      className={`draft-save-status is-${status} ${iconOnly ? "is-icon-only icon-tooltip" : ""} ${className}`.trim()}
      data-tooltip={iconOnly ? label : undefined}
      tabIndex={iconOnly ? 0 : undefined}
      role={status === "error" ? "alert" : "status"}
      aria-live={status === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <Icon aria-hidden="true" />
      <span className={iconOnly ? "draft-save-status-label" : undefined}>{label}</span>
    </span>
  );
}
