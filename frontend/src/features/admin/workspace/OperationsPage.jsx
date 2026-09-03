import { useState } from "react";
import { OperationsWorkspace } from "../../../components/operations/OperationsWorkspace.jsx";
import { OperationalCollectionPage } from "../../../components/operations/OperationalCollectionPage.jsx";
import { WorkspaceCreateActions } from "../../../components/layout/WorkspaceCreateActions.jsx";
import { api } from "../../../lib/api.js";
import { CreateInspectionPage, InspectionExperience, ProductModeSwitch } from "../../inspections/index.js";

export function OperationsPage({ actor, locations, draftQueue, onOpenWorkorder, onCreateWorkorder, inspectionAccess = { canRead: false, canWrite: false }, workorderAccess = { canRead: true, canWrite: true } }) {
  const [product, setProduct] = useState(() => !workorderAccess.canRead && inspectionAccess.canRead ? "inspections" : "workorders");
  const [creatingInspection, setCreatingInspection] = useState(false);
  const createAction = <WorkspaceCreateActions actor={actor} onCreateWorkorder={workorderAccess.canWrite ? onCreateWorkorder : null} onCreateInspection={inspectionAccess.canWrite ? () => { setProduct("inspections"); setCreatingInspection(true); } : null} />;

  return (
    <OperationalCollectionPage className="admin-content admin-operations-content" title="Operations" actions={createAction}>
      {inspectionAccess.canRead && workorderAccess.canRead ? <ProductModeSwitch value={product} onChange={(value) => { setProduct(value); setCreatingInspection(false); }} /> : null}
      {product === "inspections" && inspectionAccess.canRead
        ? creatingInspection
          ? <CreateInspectionPage actor={actor} access={{ canCreate: inspectionAccess.canWrite }} request={api} onCreated={() => setCreatingInspection(false)} onCancel={() => setCreatingInspection(false)} />
          : <InspectionExperience actor={actor} projection="admin" onCreateWorkorder={workorderAccess.canWrite ? onCreateWorkorder : null} />
        : <OperationsWorkspace actor={actor} locations={locations} {...draftQueue} onOpenWorkorder={onOpenWorkorder} />}
    </OperationalCollectionPage>
  );
}
