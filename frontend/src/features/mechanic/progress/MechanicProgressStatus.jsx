import { DraftSaveStatus } from "../../../components/drafts/DraftSaveStatus.jsx";

const LABELS = {
  pristine: "No changes",
  dirty: "Saving changes",
  saving: "Saving progress",
  saved: "Progress saved",
  error: "Progress not saved",
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
