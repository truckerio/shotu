import { DraftSaveStatus } from "../../../components/drafts/DraftSaveStatus.jsx";

export function MechanicProgressStatus({ status, error, localeText = (key) => key }) {
  return (
    <DraftSaveStatus
      status={status}
      error={error}
      showPristine={false}
      labels={{
        pristine: localeText("progress.noChanges"),
        dirty: localeText("progress.saving"),
        saving: localeText("progress.saving"),
        saved: localeText("progress.saved"),
        error: localeText("progress.notSaved"),
      }}
      className="mechanic-progress-status"
    />
  );
}
