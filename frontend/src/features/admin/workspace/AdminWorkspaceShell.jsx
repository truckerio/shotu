import { useState } from "react";
import { Briefcase02, CheckCircle, DotsVertical, MarkerPin01, Package, Settings01, Shield03, Tool02 } from "@untitledui/icons";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { ProfileMenu } from "../../../components/account/ProfileMenu.jsx";
import { RoleNavigationRail } from "../../../components/layout/RoleNavigationRail.jsx";
import { workorderTemplateStyles } from "../../../../../shared/workorder-template.js";
import { AdminSettingsWorkspace } from "./AdminSettingsWorkspace.jsx";
import { ModulesPage } from "../modules/ModulesPage.jsx";
import { ADMIN_MOBILE_DESTINATIONS, adminMobileDestinationState } from "../adminNavigation.js";
import { LocationDetailPage, LocationsPage } from "./LocationsPage.jsx";
import { OperationsPage } from "./OperationsPage.jsx";
import { InventoryWorkspace } from "../../inventory/InventoryWorkspace.jsx";
import { UnitsWorkspace } from "../../units/UnitsWorkspace.jsx";

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
  onInventoryDestination,
  inventoryWorkspaceKey,
  inventorySection,
  onInventorySectionChange,
  onInventorySectionTitleChange,
}) {
  const [operationsProduct, setOperationsProduct] = useState("");
  const phonePrimaryDestinations = ADMIN_MOBILE_DESTINATIONS.slice(0, 4);
  const phoneOverflowDestinations = ADMIN_MOBILE_DESTINATIONS.slice(4);
  const phoneOverflowActive = phoneOverflowDestinations.some((destination) => adminMobileDestinationState({ view, tab: locationDetailProps.tab, selectedId }, destination));
  const activeId = view === "operations" && operationsProduct
    ? `operations-${operationsProduct}`
    : view === "inventory"
      ? `inventory-${inventorySection}`
      : view;
  const groups = [
    { id: "operations", label: "Operations", items: [{ id: "operations-workorders", label: "Workorders", icon: Briefcase02, visible: workorderAccess.canRead }, { id: "operations-inspections", label: "Inspections", icon: CheckCircle, visible: inspectionAccess.canRead }] },
    { id: "inventory", label: "Inventory", items: [{ id: "inventory-stock", label: "Stock", icon: Package }, { id: "inventory-inbound", label: "Inbound", icon: Package }, { id: "inventory-purchases", label: "Purchasing", icon: Package }, { id: "inventory-tasks", label: "Tasks", icon: Package }, { id: "inventory-reports", label: "Reports", icon: Package }] },
    { id: "administration", label: "Administration", items: [{ id: "locations", label: "Locations", icon: MarkerPin01 }, { id: "modules", label: "Modules", icon: Shield03 }, { id: "settings", label: "Settings", icon: Settings01 }] },
  ];

  function navigate(id) {
    if (id.startsWith("operations-")) {
      setOperationsProduct(id.replace("operations-", ""));
      changeView("operations");
      return;
    }
    if (id.startsWith("inventory-")) {
      onInventoryDestination(id.replace("inventory-", ""));
      return;
    }
    changeView(id);
  }

  function navigatePhone(destination) {
    if (destination.view === "inventory") onInventoryDestination(inventorySection);
    else changeView(destination.view);
  }

  return (
    <main className="admin-shell">
      <style>{workorderTemplateStyles}</style>
      <div className="admin-shell-layout">
        <RoleNavigationRail actor={actor} ariaLabel="Admin workspace" groups={groups} items={[{ id: "units", label: "Units", variant: "parent" }]} activeId={activeId} onNavigate={navigate} />
        <div className="admin-shell-content">
          {state.error ? <p className="admin-error" role="alert">{state.error}</p> : null}
          {state.message ? <p className="admin-success" role="status">{state.message}</p> : null}
          {view === "operations" ? <OperationsPage actor={actor} locations={locations} draftQueue={draftQueue} onOpenWorkorder={onOpenWorkorder} onCreateWorkorder={onCreateWorkorder} inspectionAccess={inspectionAccess} workorderAccess={workorderAccess} requestedProduct={operationsProduct} onProductChange={setOperationsProduct} /> : null}
          {view === "inventory" ? <InventoryWorkspace key={inventoryWorkspaceKey} actorId={actor?.id} canApplyInventoryCount={actor?.role === "admin"} canReconcileAuthority={actor?.role === "admin"} presentation="page" activeSection={inventorySection} onSectionChange={onInventorySectionChange} onSectionTitleChange={onInventorySectionTitleChange} showSectionNavigation={false} showSectionNavigationOnPhone /> : null}
          {view === "units" ? <UnitsWorkspace actorId={actor?.id} /> : null}
          {view === "settings" ? <AdminSettingsWorkspace actor={actor} locations={locations} /> : null}
          {view === "modules" ? <ModulesPage {...modulePageProps} /> : null}
          {view === "locations" && selectedId && detail ? <LocationDetailPage {...locationDetailProps} /> : null}
          {view === "locations" && !(selectedId && detail) ? <LocationsPage locations={locations} loading={state.loading} onCreate={onCreateLocation} onOpen={onOpenLocation} /> : null}
        </div>
      </div>
      <nav className="admin-mobile-nav" aria-label="Admin workspace">
        {phonePrimaryDestinations.map((destination) => {
          const Icon = destination.key === "locations" ? MarkerPin01 : destination.key === "inventory" ? Package : destination.key === "modules" ? Shield03 : destination.key === "settings" ? Settings01 : Tool02;
          const active = adminMobileDestinationState({ view, tab: locationDetailProps.tab, selectedId }, destination);
          return <button className={`${active ? "active" : ""}${destination.secondary ? " secondary" : ""}`} key={destination.key} type="button" onClick={() => navigatePhone(destination)}><Icon /><span>{destination.label}</span></button>;
        })}
        <MenuTrigger>
          <Button className={`admin-mobile-more-trigger${phoneOverflowActive ? " active" : ""}`} aria-label="More admin destinations"><DotsVertical aria-hidden="true" /><span>More</span></Button>
          <Popover className="admin-mobile-more-popover" placement="top end">
            <Menu className="admin-mobile-more-menu" aria-label="More admin destinations">
              {phoneOverflowDestinations.map((destination) => {
                const Icon = destination.key === "locations" ? MarkerPin01 : destination.key === "inventory" ? Package : destination.key === "modules" ? Shield03 : destination.key === "settings" ? Settings01 : Tool02;
                const active = adminMobileDestinationState({ view, tab: locationDetailProps.tab, selectedId }, destination);
                return <MenuItem className={active ? "active" : ""} id={destination.key} key={destination.key} textValue={destination.label} onAction={() => navigatePhone(destination)}><Icon aria-hidden="true" /><span>{destination.label}</span></MenuItem>;
              })}
            </Menu>
          </Popover>
        </MenuTrigger>
        <ProfileMenu actor={actor} mobileNav />
      </nav>
    </main>
  );
}
