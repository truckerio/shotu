import { useEffect, useState } from "react";
import { ContextBreadcrumbs } from "../../../components/ui/ContextBreadcrumbs.jsx";
import { isPlainPrimaryActivation } from "../../../components/ui/context-navigation.js";
import { IntegrationsSettings } from "../integrations/IntegrationsSettings.jsx";
import { InspectionTemplatesPage } from "../templates/InspectionTemplatesPage.jsx";

function selectedSettingsTab() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("samsara")) return "integrations";
  return params.get("settingsTab") === "templates" ? "templates" : "integrations";
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
  ) : <IntegrationsSettings onOpenTemplates={() => changeTab("templates")} />;
}
