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
      className={`draft-save-status is-${status} ${className}`.trim()}
      role={status === "error" ? "alert" : "status"}
      aria-live={status === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
