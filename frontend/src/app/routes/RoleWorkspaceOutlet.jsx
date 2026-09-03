import { lazy, Suspense } from "react";
import { RefreshCw01 } from "@untitledui/icons";

import { AppLoadingFallback } from "../AppErrorBoundary.jsx";
import { CreateWorkorderPage } from "../../features/create-workorder/CreateWorkorderPage.jsx";
import { MechanicWorkspace } from "../../features/mechanic/MechanicWorkspace.jsx";
import { OfficeWorkspace } from "../../features/office/OfficeWorkspace.jsx";
import { SurveillanceWorkspace } from "../../features/surveillance/SurveillanceWorkspace.jsx";
import { WorkorderDetailPage } from "../../features/workorder-detail/WorkorderDetailPage.jsx";
import { InventoryScanWorkspace } from "../../features/inventory/InventoryScanWorkspace.jsx";
import { interfaceText } from "../../i18n/index.js";
import { productModuleCapabilities } from "./product-module-access.js";
import { InspectionExperience } from "../../features/inspections/index.js";
import { WorkspaceHeader } from "../../components/layout/WorkspaceHeader.jsx";
import { PageHeader } from "../../components/layout/PageHeader.jsx";

const AdminWorkspace = lazy(() => import("../../features/admin/AdminWorkspace.jsx")
  .then((module) => ({ default: module.AdminWorkspace })));

export function RoleWorkspaceOutlet({
  activeWorkorder,
  actor,
  createPageProps,
  detailPageProps,
  draftWorkspaceProps,
  interfacePreferences,
  navigation,
  routeLoading,
  workspace,
}) {
  const locale = actor?.role === "mechanic" ? interfacePreferences?.locale || "en" : "en";
  const t = (key) => interfaceText(locale, key);
  const inspectionAccess = productModuleCapabilities(actor, "inspections");
  const workorderAccess = productModuleCapabilities(actor, "workorders");
  if (new URLSearchParams(window.location.search).has("inventoryScan")) {
    return <InventoryScanWorkspace actor={actor} />;
  }
  if (routeLoading) {
    return (
      <main className="prototype mechanic-home route-loading">
        <div className="mechanic-empty-state">
          <RefreshCw01 className="loading-icon" />
          <strong>{t("create.openingWorkorder")}</strong>
        </div>
      </main>
    );
  }

  if (workspace === "mechanic") {
    return (
      <MechanicWorkspace
        actor={actor}
        locale={interfacePreferences.locale}
        localeError={interfacePreferences.error}
        localeReady={interfacePreferences.ready}
        onLocaleChange={interfacePreferences.onLocaleChange}
        onCreateWorkorder={navigation.canOpenCreateWorkspace ? navigation.openCreateWorkspace : null}
        onOpenWorkorder={navigation.openOperationalWorkorder}
        inspectionAccess={inspectionAccess}
        workorderAccess={workorderAccess}
      />
    );
  }

  if (workspace === "admin") {
    return (
      <Suspense fallback={<AppLoadingFallback />}>
        <AdminWorkspace
          actor={actor}
          {...draftWorkspaceProps}
          onCreateWorkorder={navigation.canOpenCreateWorkspace ? navigation.openCreateWorkspace : null}
          onOpenWorkorder={navigation.openOfficeWorkorder}
          inspectionAccess={inspectionAccess}
          workorderAccess={workorderAccess}
        />
      </Suspense>
    );
  }

  if (workspace === "office") {
    return (
      <OfficeWorkspace
        actor={actor}
        {...draftWorkspaceProps}
        onCreateWorkorder={navigation.canOpenCreateWorkspace ? navigation.openCreateWorkspace : null}
        onOpenWorkorder={navigation.openOfficeWorkorder}
        inspectionAccess={inspectionAccess}
        workorderAccess={workorderAccess}
      />
    );
  }

  if (workspace === "surveillance") {
    if (inspectionAccess.canRead && !workorderAccess.canRead) {
      return <main className="prototype mechanic-home workspace-operations"><WorkspaceHeader actor={actor} className="role-home-account-header" locale="en" /><div className="mechanic-home-content"><PageHeader title="Inspections" /><InspectionExperience actor={actor} projection="read_only" /></div></main>;
    }
    return <SurveillanceWorkspace actor={actor} inspectionAccess={inspectionAccess} workorderAccess={workorderAccess} />;
  }

  if (activeWorkorder) {
    return <WorkorderDetailPage {...detailPageProps} />;
  }

  if (!navigation.canOpenCreateWorkspace) {
    return (
      <main className="prototype mechanic-home">
        <div className="mechanic-empty-state" role="status">
          <strong>{t("create.unavailable")}</strong>
          <span>{t("create.routeUnavailableMessage")}</span>
        </div>
      </main>
    );
  }

  return <CreateWorkorderPage {...createPageProps} />;
}
