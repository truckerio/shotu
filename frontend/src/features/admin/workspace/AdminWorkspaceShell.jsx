import { File02, MarkerPin01, SearchMd, Settings01, Tool02, Users01 } from "@untitledui/icons";
import { ProfileMenu } from "../../../components/account/ProfileMenu.jsx";
import { WorkspaceHeader } from "../../../components/layout/WorkspaceHeader.jsx";
import { SurveillanceWorkspace } from "../../surveillance/SurveillanceWorkspace.jsx";
import { workorderTemplateStyles } from "../../../../../shared/workorder-template.js";
import { IntegrationsSettings } from "../integrations/IntegrationsSettings.jsx";
import {
  ADMIN_MOBILE_DESTINATIONS,
  adminMobileDestinationState,
} from "../adminNavigation.js";
import { LocationDetailPage, LocationsPage } from "./LocationsPage.jsx";
import { OperationsPage } from "./OperationsPage.jsx";

function mobileDestinationIcon(key) {
  if (key === "locations") return MarkerPin01;
  if (key === "surveillance") return SearchMd;
  if (key === "users") return Users01;
  if (key === "template") return File02;
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
}) {
  return (
    <main className="admin-shell">
      <style>{workorderTemplateStyles}</style>
      <WorkspaceHeader actor={actor} className="admin-workspace-header">
        <nav className="admin-primary-nav" aria-label="Admin workspace">
          <button className={view === "operations" ? "active" : ""} type="button" onClick={() => changeView("operations")}><Tool02 />Operations</button>
          <button className={view === "surveillance" ? "active" : ""} type="button" onClick={() => changeView("surveillance")}><SearchMd />Odoo entry</button>
          <button className={view === "locations" ? "active" : ""} type="button" onClick={() => changeView("locations")}><MarkerPin01 />Locations</button>
          <button className={view === "settings" ? "active" : ""} type="button" onClick={() => changeView("settings")}><Settings01 />Settings</button>
        </nav>
      </WorkspaceHeader>
      {state.error ? <p className="admin-error" role="alert">{state.error}</p> : null}
      {state.message ? <p className="admin-success" role="status">{state.message}</p> : null}
      {view === "operations" ? <OperationsPage actor={actor} locations={locations} draftQueue={draftQueue} onOpenWorkorder={onOpenWorkorder} onCreateWorkorder={onCreateWorkorder} /> : null}
      {view === "surveillance" ? <SurveillanceWorkspace actor={actor} embedded /> : null}
      {view === "settings" ? <IntegrationsSettings /> : null}
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
