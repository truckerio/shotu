import { DraftSaveStatus } from "../../../components/drafts/DraftSaveStatus.jsx";

const LABELS = {
  pristine: "No changes",
  dirty: "Saving…",
  saving: "Saving…",
  saved: "Saved",
  error: "Not saved",
};

export function MechanicProgressStatus({ status, error }) {
  return (
    <DraftSaveStatus
      status={status}
      error={error}
      showPristine={false}
      labels={LABELS}
      className="mechanic-progress-status"
    />
  );
}
