import { PurchaseOrderApprovalSettings } from './PurchaseOrderApprovalSettings.jsx';
import { useEffect, useState } from "react";
import { ContextBreadcrumbs } from "../../../components/ui/ContextBreadcrumbs.jsx";
import { isPlainPrimaryActivation } from "../../../components/ui/context-navigation.js";
import { IntegrationsSettings } from "../integrations/IntegrationsSettings.jsx";
import { IntegrationSummaryCard } from "../integrations/IntegrationSummaryCard.jsx";
import { InspectionTemplatesPage } from "../templates/InspectionTemplatesPage.jsx";
import { InventoryLocationsWorkspace } from "../../inventory/InventoryLocationsWorkspace.jsx";

function selectedSettingsTab() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("samsara")) return "integrations";
  const tab = params.get("settingsTab");
  return tab === "templates" || tab === "storage-layout" ? tab : "integrations";
}

export function AdminSettingsWorkspace({ actor, locations }) {
  const [tab, setTab] = useState(selectedSettingsTab);

  useEffect(() => {
    const syncTab = () => setTab(selectedSettingsTab());
    window.addEventListener("popstate", syncTab);
    return () => window.removeEventListener("popstate", syncTab);
  }, []);

  function changeTab(nextTab) {
    const params = new URLSearchParams(window.location.search);
    params.set("adminView", "settings");
    params.set("settingsTab", nextTab);
    params.delete("integration");
    window.history.pushState({}, "", `/?${params.toString()}`);
    setTab(nextTab);
  }

  if (tab === "storage-layout") {
    return (
      <>
        <div className="admin-content" style={{ paddingBottom: 0 }}>
          <ContextBreadcrumbs
            items={[{
              label: "Settings",
              href: "/?adminView=settings&settingsTab=integrations",
              onClick: (event) => {
                if (!isPlainPrimaryActivation(event)) return;
                event.preventDefault();
                changeTab("integrations");
              },
            }]}
            current="Storage layout"
          />
        </div>
        <div className="admin-content">
          <InventoryLocationsWorkspace
            locations={locations}
            canApplyInventoryCount={actor?.role === "admin"}
          />
        </div>
      </>
    );
  }

  return tab === "templates" ? (
    <>
      <div className="admin-content" style={{ paddingBottom: 0 }}>
        <ContextBreadcrumbs
          items={[{
            label: "Settings",
            href: "/?adminView=settings&settingsTab=integrations",
            onClick: (event) => {
              if (!isPlainPrimaryActivation(event)) return;
              event.preventDefault();
              changeTab("integrations");
            },
          }]}
          current="Templates"
        />
      </div>
      <InspectionTemplatesPage actor={actor} locations={locations} />
    </>
  ) : <IntegrationsSettings
    onOpenTemplates={() => changeTab("templates")}
    additionalSettings={<>
      <IntegrationSummaryCard
        category="Inventory"
        description="Set up the storage hierarchy used for receiving, picking, and stock locations."
        onManage={() => changeTab("storage-layout")}
        title="Storage layout"
      />
      <PurchaseOrderApprovalSettings locations={locations} embedded />
    </>}
  />;
}
