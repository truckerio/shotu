import { lazy, Suspense } from "react";
import { RefreshCw01 } from "@untitledui/icons";

import { AppLoadingFallback } from "../AppErrorBoundary.jsx";
import { interfaceText } from "../../i18n/index.js";
import { productModuleCapabilities } from "./product-module-access.js";

const CreateWorkorderPage = lazy(() => import("../../features/create-workorder/CreateWorkorderPage.jsx")
  .then((module) => ({ default: module.CreateWorkorderPage })));
const MechanicWorkspace = lazy(() => import("../../features/mechanic/MechanicWorkspace.jsx")
  .then((module) => ({ default: module.MechanicWorkspace })));
const OfficeWorkspace = lazy(() => import("../../features/office/OfficeWorkspace.jsx")
  .then((module) => ({ default: module.OfficeWorkspace })));
const SurveillanceWorkspace = lazy(() => import("../../features/surveillance/SurveillanceWorkspace.jsx")
  .then((module) => ({ default: module.SurveillanceWorkspace })));
const WorkorderDetailPage = lazy(() => import("../../features/workorder-detail/WorkorderDetailPage.jsx")
  .then((module) => ({ default: module.WorkorderDetailPage })));
const InventoryScanWorkspace = lazy(() => import("../../features/inventory/InventoryScanWorkspace.jsx")
  .then((module) => ({ default: module.InventoryScanWorkspace })));
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
    return <Suspense fallback={<AppLoadingFallback />}><InventoryScanWorkspace actor={actor} /></Suspense>;
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
      <Suspense fallback={<AppLoadingFallback />}>
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
      </Suspense>
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
      <Suspense fallback={<AppLoadingFallback />}>
        <OfficeWorkspace
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

  if (workspace === "surveillance") {
    return <Suspense fallback={<AppLoadingFallback />}><SurveillanceWorkspace actor={actor} inspectionAccess={inspectionAccess} workorderAccess={workorderAccess} /></Suspense>;
  }

  if (activeWorkorder) {
    return <Suspense fallback={<AppLoadingFallback />}><WorkorderDetailPage {...detailPageProps} /></Suspense>;
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

  return <Suspense fallback={<AppLoadingFallback />}><CreateWorkorderPage {...createPageProps} /></Suspense>;
}
