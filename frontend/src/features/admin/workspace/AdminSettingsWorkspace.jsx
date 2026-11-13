import { File02, Rows03 } from "@untitledui/icons";
import { useEffect, useState } from "react";
import { ContextBreadcrumbs } from "../../../components/ui/ContextBreadcrumbs.jsx";
import { isPlainPrimaryActivation } from "../../../components/ui/context-navigation.js";
import { IntegrationsSettings } from "../integrations/IntegrationsSettings.jsx";
import { IntegrationSummaryCard } from "../integrations/IntegrationSummaryCard.jsx";
import { InspectionTemplatesPage } from "../templates/InspectionTemplatesPage.jsx";
import { InventoryLocationsWorkspace } from "../../inventory/InventoryLocationsWorkspace.jsx";
import { PurchaseOrderApprovalSettings } from "./PurchaseOrderApprovalSettings.jsx";
import { BusinessSetupPage } from "../onboarding/BusinessSetupPage.jsx";
import { BusinessSetupBilling } from "../onboarding/BusinessSetupBilling.jsx";
import { CommercialProfileSettings } from "../commercial/CommercialProfileSettings.jsx";

function selectedSettingsTab() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("samsara")) return "integrations";
  const tab = params.get("settingsTab");
  return tab === "templates" || tab === "storage-layout" || tab === "commercial" || tab === "business" ? tab : "integrations";
}

export function AdminSettingsWorkspace({ actor, locations }) {
  const [tab, setTab] = useState(selectedSettingsTab);

  useEffect(() => {
    const syncTab = () => setTab(selectedSettingsTab());
    window.addEventListener("popstate", syncTab);
    return () => window.removeEventListener("popstate", syncTab);
  }, []);

  function changeTab(nextTab, scope = {}) {
    const params = new URLSearchParams(window.location.search);
    params.set("adminView", "settings");
    params.set("settingsTab", nextTab);
    params.delete("integration");
    params.delete("businessSetup");
    for (const [key, value] of Object.entries(scope)) { if (value) params.set(key, value); else params.delete(key); }
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

  if (tab === "business") return <BusinessSetupPage locations={locations} onOpenBilling={(companyId, locationId) => changeTab("commercial", { businessSetup: "1", commercialCompany: companyId, commercialLocation: locationId })} />;
  if (tab === "commercial" && new URLSearchParams(window.location.search).get("businessSetup") === "1") return <BusinessSetupBilling locations={locations} onBack={() => changeTab("business")} />;

  if (tab === "commercial") return (
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
          current="Customer commercial profile"
        />
      </div>
      <CommercialProfileSettings actor={actor} locations={locations} />
    </>
  );

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
      <IntegrationSummaryCard icon={File02} title="Business setup" description="Set up your fleet or repair shop. Add customer billing when needed." onManage={() => changeTab("business")} />
      <IntegrationSummaryCard
        category="Inventory"
        description="Set up the storage hierarchy used for receiving, picking, and stock locations."
        icon={Rows03}
        onManage={() => changeTab("storage-layout")}
        title="Storage layout"
      />
      <PurchaseOrderApprovalSettings locations={locations} embedded />
      <IntegrationSummaryCard icon={File02} title="Customer commercial profile" onManage={() => changeTab("commercial")} />
    </>}
  />;
}
