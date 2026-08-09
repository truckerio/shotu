import { Plus } from "@untitledui/icons";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { OperationsWorkspace } from "../../../components/operations/OperationsWorkspace.jsx";
import { Button } from "../../../components/ui/Button.jsx";

export function OperationsPage({ actor, locations, draftQueue, onOpenWorkorder, onCreateWorkorder }) {
  const createAction = onCreateWorkorder
    ? <Button variant="primary" icon={Plus} onClick={onCreateWorkorder}>Create workorder</Button>
    : null;

  return (
    <section className="admin-content admin-operations-content">
      <PageHeader
        title="Operations"
        actions={createAction}
      />
      <OperationsWorkspace actor={actor} locations={locations} {...draftQueue} onOpenWorkorder={onOpenWorkorder} />
    </section>
  );
}
