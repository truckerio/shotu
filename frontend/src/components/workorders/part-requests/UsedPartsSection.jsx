import { UsedPartsEditor } from "../UsedPartsEditor.jsx";

export function UsedPartsSection({
  actorId,
  detail,
  parts,
  onPartsChange,
  onSaveParts,
  editable,
  readonlyMessage,
  suggestionsEnabled,
  id,
  hidden,
}) {
  return (
    <div id={id} hidden={hidden}>
      <UsedPartsEditor
        actorId={actorId}
        detail={detail}
        parts={parts}
        onChange={onPartsChange}
        onSave={onSaveParts}
        disabled={!editable}
        readonlyMessage={readonlyMessage}
        minimumRows={0}
        suggestionsEnabled={suggestionsEnabled}
      />
    </div>
  );
}
