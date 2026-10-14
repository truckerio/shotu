import { CheckpointCollection } from "../ui/CheckpointCollection.jsx";
import { checkpointPreview } from "./checkpoint-position.js";

// Workorders supply presentation and preview text; windowing/scrolling is shared.
export function CheckpointQueueTable(props) {
  return <CheckpointCollection {...props} label="workorders" pageSize={20}
    getPreview={(page) => checkpointPreview(props.queue.pages.find((batch) => batch.page === page)?.items)} />;
}
