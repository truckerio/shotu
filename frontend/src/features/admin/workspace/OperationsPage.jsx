import { Plus } from "@untitledui/icons";
import { OperationsWorkspace } from "../../../components/operations/OperationsWorkspace.jsx";
import { OperationalCollectionPage } from "../../../components/operations/OperationalCollectionPage.jsx";
import { Button } from "../../../components/ui/Button.jsx";

export function OperationsPage({ actor, locations, draftQueue, onOpenWorkorder, onCreateWorkorder }) {
  const createAction = onCreateWorkorder
    ? <Button variant="primary" icon={Plus} onClick={onCreateWorkorder}>Create workorder</Button>
    : null;

  return (
    <OperationalCollectionPage className="admin-content admin-operations-content" title="Operations" actions={createAction}>
      <OperationsWorkspace actor={actor} locations={locations} {...draftQueue} onOpenWorkorder={onOpenWorkorder} />
    </OperationalCollectionPage>
  );
}
