import { useEffect, useState } from "react";
import { OperationsWorkspace } from "../../../components/operations/OperationsWorkspace.jsx";
import { OperationalCollectionPage } from "../../../components/operations/OperationalCollectionPage.jsx";
import { WorkspaceCreateActions } from "../../../components/layout/WorkspaceCreateActions.jsx";
import { api } from "../../../lib/api.js";
import { CreateInspectionPage, InspectionExperience } from "../../inspections/index.js";
import { inspectionReturnContext } from "../../../app/routes/route-state.js";
import "./operations-page.css";

export function OperationsPage({ actor, locations, draftQueue, onOpenWorkorder, onCreateWorkorder, inspectionAccess = { canRead: false, canWrite: false }, workorderAccess = { canRead: true, canWrite: true }, requestedProduct = "", onProductChange }) {
  const inspectionReturn = inspectionReturnContext();
  const initialInspectionId = inspectionAccess.canRead ? inspectionReturn?.inspectionId || "" : "";
  const [product, setProduct] = useState(() => initialInspectionId || (!workorderAccess.canRead && inspectionAccess.canRead) ? "inspections" : "workorders");
  const [creatingInspection, setCreatingInspection] = useState(false);
  const [createdInspectionId, setCreatedInspectionId] = useState("");
  const createAction = <WorkspaceCreateActions actor={actor} onCreateWorkorder={workorderAccess.canWrite ? onCreateWorkorder : null} onCreateInspection={inspectionAccess.canWrite ? () => { setProduct("inspections"); setCreatingInspection(true); } : null} />;

  useEffect(() => {
    if (requestedProduct && requestedProduct !== product) changeProduct(requestedProduct);
  }, [requestedProduct]);

  function changeProduct(nextProduct) {
    setProduct(nextProduct);
    onProductChange?.(nextProduct);
    setCreatingInspection(false);
    setCreatedInspectionId("");
  }

  return (
    <OperationalCollectionPage
      className="admin-content admin-operations-content"
      title={product === "inspections" ? "Inspections" : "Workorders"}
      actions={createAction}
      surface
    >
      {workorderAccess.canRead ? <div hidden={product !== "workorders"}>
        <OperationsWorkspace actor={actor} locations={locations} {...draftQueue} onOpenWorkorder={onOpenWorkorder} />
      </div> : null}
      {product === "inspections" && inspectionAccess.canRead
        ? creatingInspection
          ? <CreateInspectionPage actor={actor} access={{ canCreate: inspectionAccess.canWrite }} request={api} onCreated={(result) => { setCreatingInspection(false); setCreatedInspectionId(result?.inspection?.id || ""); }} onCancel={() => setCreatingInspection(false)} />
          : <InspectionExperience actor={actor} projection="admin" initialInspectionId={createdInspectionId || initialInspectionId} onCreateWorkorder={workorderAccess.canWrite ? onCreateWorkorder : null} onOpenWorkorder={workorderAccess.canRead ? onOpenWorkorder : null} />
        : null}
    </OperationalCollectionPage>
  );
}
