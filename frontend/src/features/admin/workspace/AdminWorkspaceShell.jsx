import { FileCheck02, MarkerPin01, Settings01, Shield03, Tool02 } from "@untitledui/icons";
import { ProfileMenu } from "../../../components/account/ProfileMenu.jsx";
import { WorkspaceHeader } from "../../../components/layout/WorkspaceHeader.jsx";
import { workorderTemplateStyles } from "../../../../../shared/workorder-template.js";
import { IntegrationsSettings } from "../integrations/IntegrationsSettings.jsx";
import { ModulesPage } from "../modules/ModulesPage.jsx";
import {
  ADMIN_MOBILE_DESTINATIONS,
  adminMobileDestinationState,
} from "../adminNavigation.js";
import { LocationDetailPage, LocationsPage } from "./LocationsPage.jsx";
import { OperationsPage } from "./OperationsPage.jsx";
import { InvoiceExtractionWorkspace } from "../../office/InvoiceExtractionWorkspace.jsx";

function mobileDestinationIcon(key) {
  if (key === "locations") return MarkerPin01;
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
          <button className={view === "invoices" ? "active" : ""} type="button" onClick={() => changeView("invoices")}><FileCheck02 />Invoices</button>
          <button className={view === "locations" ? "active" : ""} type="button" onClick={() => changeView("locations")}><MarkerPin01 />Locations</button>
          <button className={view === "modules" ? "active" : ""} type="button" onClick={() => changeView("modules")}><Shield03 />Modules</button>
          <button className={view === "settings" ? "active" : ""} type="button" onClick={() => changeView("settings")}><Settings01 />Settings</button>
        </nav>
      </WorkspaceHeader>
      {state.error ? <p className="admin-error" role="alert">{state.error}</p> : null}
      {state.message ? <p className="admin-success" role="status">{state.message}</p> : null}
      {view === "operations" ? <OperationsPage actor={actor} locations={locations} draftQueue={draftQueue} onOpenWorkorder={onOpenWorkorder} onCreateWorkorder={onCreateWorkorder} /> : null}
      {view === "invoices" ? <InvoiceExtractionWorkspace /> : null}
      {view === "settings" ? <IntegrationsSettings /> : null}
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
