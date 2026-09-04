import { MarkerPin01, Package, Settings01, Shield03, Tool02 } from "@untitledui/icons";
import { ProfileMenu } from "../../../components/account/ProfileMenu.jsx";
import { WorkspaceHeader } from "../../../components/layout/WorkspaceHeader.jsx";
import { workorderTemplateStyles } from "../../../../../shared/workorder-template.js";
import { AdminSettingsWorkspace } from "./AdminSettingsWorkspace.jsx";
import { ModulesPage } from "../modules/ModulesPage.jsx";
import {
  ADMIN_MOBILE_DESTINATIONS,
  adminMobileDestinationState,
} from "../adminNavigation.js";
import { LocationDetailPage, LocationsPage } from "./LocationsPage.jsx";
import { OperationsPage } from "./OperationsPage.jsx";
import { InventoryWorkspace } from "../../inventory/InventoryWorkspace.jsx";
import { UnitsWorkspace } from "../../units/UnitsWorkspace.jsx";

function mobileDestinationIcon(key) {
  if (key === "locations") return MarkerPin01;
  if (key === "inventory") return Package;
  if (key === "modules") return Shield03;
  if (key === "settings") return Settings01;
  return Tool02;
}

export function AdminWorkspaceShell({
  actor,
  view,
  changeView,
  state,
  locations,
  draftQueue,
  onOpenWorkorder,
  onCreateWorkorder,
  inspectionAccess,
  workorderAccess,
  selectedId,
  detail,
  locationDetailProps,
  onCreateLocation,
  onOpenLocation,
  modulePageProps,
}) {
  return (
    <main className="admin-shell">
      <style>{workorderTemplateStyles}</style>
      <WorkspaceHeader actor={actor} className="admin-workspace-header">
        <nav className="admin-primary-nav" aria-label="Admin workspace">
          <button className={view === "operations" ? "active" : ""} type="button" onClick={() => changeView("operations")}><Tool02 />Operations</button>
          <button className={view === "inventory" ? "active" : ""} type="button" onClick={() => changeView("inventory")}><Package />Inventory</button>
          <button className={view === "units" ? "active" : ""} type="button" onClick={() => changeView("units")}><Tool02 />Units</button>
          <button className={view === "locations" ? "active" : ""} type="button" onClick={() => changeView("locations")}><MarkerPin01 />Locations</button>
          <button className={view === "modules" ? "active" : ""} type="button" onClick={() => changeView("modules")}><Shield03 />Modules</button>
          <button className={view === "settings" ? "active" : ""} type="button" onClick={() => changeView("settings")}><Settings01 />Settings</button>
        </nav>
      </WorkspaceHeader>
      {state.error ? <p className="admin-error" role="alert">{state.error}</p> : null}
      {state.message ? <p className="admin-success" role="status">{state.message}</p> : null}
      {view === "operations" ? <OperationsPage actor={actor} locations={locations} draftQueue={draftQueue} onOpenWorkorder={onOpenWorkorder} onCreateWorkorder={onCreateWorkorder} inspectionAccess={inspectionAccess} workorderAccess={workorderAccess} /> : null}
      {view === "inventory" ? <InventoryWorkspace actorId={actor?.id} canApplyInventoryCount={actor?.role === "admin"} canReconcileAuthority={actor?.role === "admin"} presentation="page" /> : null}
      {view === "units" ? <UnitsWorkspace actorId={actor?.id} /> : null}
      {view === "settings" ? <AdminSettingsWorkspace actor={actor} locations={locations} /> : null}
      {view === "modules" ? <ModulesPage {...modulePageProps} /> : null}
      {view === "locations" && selectedId && detail ? <LocationDetailPage {...locationDetailProps} /> : null}
      {view === "locations" && !(selectedId && detail) ? <LocationsPage locations={locations} loading={state.loading} onCreate={onCreateLocation} onOpen={onOpenLocation} /> : null}
      <nav className="admin-mobile-nav" aria-label="Admin workspace">
        {ADMIN_MOBILE_DESTINATIONS.map((destination) => {
          const Icon = mobileDestinationIcon(destination.key);
          const active = adminMobileDestinationState({ view, tab: locationDetailProps.tab, selectedId }, destination);
          return (
            <button
              className={`${active ? "active" : ""}${destination.secondary ? " secondary" : ""}`}
              key={destination.key}
              type="button"
              onClick={() => changeView(destination.view)}
            >
              <Icon />
              <span>{destination.label}</span>
            </button>
          );
        })}
        <ProfileMenu actor={actor} mobileNav />
      </nav>
    </main>
  );
}
