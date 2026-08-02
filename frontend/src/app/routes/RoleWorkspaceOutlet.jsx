import { lazy, Suspense } from "react";
import { RefreshCw01 } from "@untitledui/icons";

import { CreateWorkorderPage } from "../../features/create-workorder/CreateWorkorderPage.jsx";
import { MechanicWorkspace } from "../../features/mechanic/MechanicWorkspace.jsx";
import { OfficeWorkspace } from "../../features/office/OfficeWorkspace.jsx";
import { SurveillanceWorkspace } from "../../features/surveillance/SurveillanceWorkspace.jsx";
import { WorkorderDetailPage } from "../../features/workorder-detail/WorkorderDetailPage.jsx";

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
  if (routeLoading) {
    return (
      <main className="prototype mechanic-home route-loading">
        <div className="mechanic-empty-state">
          <RefreshCw01 className="loading-icon" />
          <strong>Opening workorder...</strong>
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
        onLocaleChange={interfacePreferences.onLocaleChange}
        onCreateWorkorder={navigation.openCreateWorkspace}
        onOpenWorkorder={navigation.openOperationalWorkorder}
      />
    );
  }

  if (workspace === "admin") {
    return (
      <Suspense fallback={null}>
        <AdminWorkspace
          actor={actor}
          {...draftWorkspaceProps}
          onCreateWorkorder={navigation.openCreateWorkspace}
          onOpenWorkorder={navigation.openOfficeWorkorder}
        />
      </Suspense>
    );
  }

  if (workspace === "office") {
    return (
      <OfficeWorkspace
        actor={actor}
        {...draftWorkspaceProps}
        onCreateWorkorder={navigation.openCreateWorkspace}
        onOpenWorkorder={navigation.openOfficeWorkorder}
      />
    );
  }

  if (workspace === "surveillance") {
    return <SurveillanceWorkspace actor={actor} />;
  }

  if (activeWorkorder) {
    return <WorkorderDetailPage {...detailPageProps} />;
  }

  return <CreateWorkorderPage {...createPageProps} />;
}
