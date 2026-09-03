import { useState } from "react";
import { Check, ChevronDown } from "@untitledui/icons";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { OperationsWorkspace } from "../../../components/operations/OperationsWorkspace.jsx";
import { OperationalCollectionPage } from "../../../components/operations/OperationalCollectionPage.jsx";
import { WorkspaceCreateActions } from "../../../components/layout/WorkspaceCreateActions.jsx";
import { api } from "../../../lib/api.js";
import { CreateInspectionPage, InspectionExperience } from "../../inspections/index.js";
import { inspectionReturnContext } from "../../../app/routes/route-state.js";
import "./operations-page.css";

const PRODUCT_VIEWS = [
  { id: "workorders", label: "Workorders", description: "Manage repair work" },
  { id: "inspections", label: "Inspections", description: "Review scheduled checks" },
];

function OperationsTitle({ product, canSwitch, onChange }) {
  const selected = PRODUCT_VIEWS.find((view) => view.id === product) || PRODUCT_VIEWS[0];

  if (!canSwitch) return selected.label;

  return (
    <MenuTrigger>
      <AriaButton className="operations-page-title-trigger" aria-label={`Current view: ${selected.label}`}>
        <span>{selected.label}</span>
        <ChevronDown aria-hidden="true" />
      </AriaButton>
      <Popover className="operations-page-title-popover" placement="bottom start">
        <Menu className="operations-page-title-menu" aria-label="Choose Operations view" onAction={onChange}>
          {PRODUCT_VIEWS.map((view) => (
            <MenuItem className="operations-page-title-menu-item" id={view.id} key={view.id} textValue={view.label} aria-current={product === view.id ? "page" : undefined}>
              <span><strong>{view.label}</strong><small>{view.description}</small></span>
              {product === view.id ? <Check aria-hidden="true" /> : null}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

export function OperationsPage({ actor, locations, draftQueue, onOpenWorkorder, onCreateWorkorder, inspectionAccess = { canRead: false, canWrite: false }, workorderAccess = { canRead: true, canWrite: true } }) {
  const inspectionReturn = inspectionReturnContext();
  const initialInspectionId = inspectionAccess.canRead && workorderAccess.canRead ? inspectionReturn?.inspectionId || "" : "";
  const [product, setProduct] = useState(() => initialInspectionId || (!workorderAccess.canRead && inspectionAccess.canRead) ? "inspections" : "workorders");
  const [creatingInspection, setCreatingInspection] = useState(false);
  const [createdInspectionId, setCreatedInspectionId] = useState("");
  const createAction = <WorkspaceCreateActions actor={actor} onCreateWorkorder={workorderAccess.canWrite ? onCreateWorkorder : null} onCreateInspection={inspectionAccess.canWrite ? () => { setProduct("inspections"); setCreatingInspection(true); } : null} />;
  const canSwitch = inspectionAccess.canRead && workorderAccess.canRead;

  function changeProduct(nextProduct) {
    setProduct(nextProduct);
    setCreatingInspection(false);
    setCreatedInspectionId("");
  }

  return (
    <OperationalCollectionPage
      className="admin-content admin-operations-content"
      title={<OperationsTitle product={product} canSwitch={canSwitch} onChange={changeProduct} />}
      actions={createAction}
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
