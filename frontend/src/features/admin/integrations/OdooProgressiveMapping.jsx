import { useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "@untitledui/icons";
import { Button } from "../../../components/ui/Button.jsx";
import "./odoo-progressive-mapping.css";

function vehicleLabel(asset = {}) {
  return asset.unitNo || asset.name || "Unnamed unit";
}

function vehicleDetails(asset = {}) {
  return [
    asset.unitType,
    asset.vin && `VIN ${asset.vin}`,
    asset.licensePlate && `Plate ${asset.licensePlate}`,
  ].filter(Boolean).join(" · ");
}

function warehouseLabel(warehouse = {}) {
  return `${warehouse.code ? `${warehouse.code} · ` : ""}${warehouse.name || "Unnamed warehouse"}`;
}

function uniqueVehicleChoices(item, odooVehicleOptions) {
  return [...new Map([
    ...(item.suggestion ? [item.suggestion] : []),
    ...(item.candidates || []),
    ...odooVehicleOptions,
  ].map((candidate) => [candidate.externalId, candidate])).values()];
}

function vehicleHelper(item, status, vehicleSuggestionLabel) {
  if (status === "ignored") return "This unit is intentionally excluded.";
  if (status === "suggested") return `Suggested by ${vehicleSuggestionLabel(item.suggestion?.basis)}; confirm only if the Odoo truck is correct.`;
  return "Search Odoo above, choose a result, or enter the exact Odoo vehicle ID.";
}

/**
 * Presentational workflow for outbound Odoo mapping.
 *
 * All drafts and persistence callbacks remain owned by the parent. Collapsed
 * panels use `hidden`, rather than conditional rendering, so field values are
 * never destroyed while an admin moves between mapping steps.
 */
export function OdooProgressiveMapping({
  vehicles = [],
  vehicleDrafts = {},
  odooVehicleOptions = [],
  vehicleQuery = "",
  odooVehicleQuery = "",
  warehouses = [],
  warehouseOptions = [],
  warehouseDrafts = {},
  vehicleSummary = "",
  warehouseSummary = "",
  busyKey = "",
  vehicleNextCursor = null,
  onVehicleQueryChange,
  onVehicleSearch,
  onOdooVehicleQueryChange,
  onOdooVehicleSearch,
  onVehicleDraftChange,
  onConfirmVehicle,
  onLoadMoreVehicles,
  onWarehouseDraftChange,
  onConfirmWarehouse,
  vehicleSuggestionLabel = (basis) => basis || "matching",
}) {
  const [activeStep, setActiveStep] = useState("vehicles");
  const [vehiclesExpanded, setVehiclesExpanded] = useState(true);
  const [warehouseExpanded, setWarehouseExpanded] = useState(false);
  const warehouseHeadingRef = useRef(null);
  const vehicleNeedsReview = vehicles.filter((item) => !["mapped", "ignored"].includes(item.mappingStatus || item.status)).length;
  const warehouseNeedsReview = warehouses.filter((item) => (item.mappingStatus || item.status) !== "mapped").length;
  const vehicleConfirmed = vehicles.filter((item) => (item.mappingStatus || item.status) === "mapped").length;
  const warehouseConfirmed = warehouses.filter((item) => (item.mappingStatus || item.status) === "mapped").length;
  const vehicleCountLabel = vehicleSummary || `${vehicleConfirmed} confirmed`;
  const warehouseCountLabel = warehouseSummary || `${warehouseConfirmed} confirmed`;

  function revealWarehouses() {
    setActiveStep("warehouses");
    setWarehouseExpanded(true);
    requestAnimationFrame(() => warehouseHeadingRef.current?.focus());
  }

  return (
    <section className="odoo-progressive-mapping" aria-label="Outbound Odoo mappings">
      <section className="odoo-progressive-mapping__section" aria-labelledby="odoo-progressive-vehicle-heading" data-active={activeStep === "vehicles"}>
        <div className="odoo-progressive-mapping__section-header">
          <div>
            <p className="odoo-progressive-mapping__step">Step 1</p>
            <h4 id="odoo-progressive-vehicle-heading">Truck mappings</h4>
            <p>Confirm the exact Odoo vehicle for each app unit.</p>
            <small>{vehicleCountLabel} · Needs review: {vehicleNeedsReview}</small>
          </div>
          <button
            aria-controls="odoo-progressive-vehicle-panel"
            aria-expanded={vehiclesExpanded}
            className="odoo-progressive-mapping__toggle"
            onClick={() => { setActiveStep("vehicles"); setVehiclesExpanded((expanded) => !expanded); }}
            type="button"
          >
            {vehiclesExpanded ? "Collapse" : "Show trucks"}
            {vehiclesExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </button>
        </div>

        <div className="odoo-progressive-mapping__panel" hidden={!vehiclesExpanded} id="odoo-progressive-vehicle-panel">
          <div className="odoo-progressive-mapping__searches">
            <form onSubmit={(event) => { event.preventDefault(); onVehicleSearch?.(); }}>
              <label htmlFor="odoo-progressive-vehicle-search">Find app unit</label>
              <div>
                <input id="odoo-progressive-vehicle-search" onChange={(event) => onVehicleQueryChange?.(event.target.value)} placeholder="Unit, VIN, or plate" type="search" value={vehicleQuery} />
                <Button type="submit">Search</Button>
              </div>
            </form>
            <form onSubmit={(event) => { event.preventDefault(); onOdooVehicleSearch?.(); }}>
              <label htmlFor="odoo-progressive-odoo-vehicle-search">Find Odoo vehicle</label>
              <div>
                <input id="odoo-progressive-odoo-vehicle-search" onChange={(event) => onOdooVehicleQueryChange?.(event.target.value)} placeholder="Odoo name, ID, VIN, unit, or plate" type="search" value={odooVehicleQuery} />
                <Button type="submit">Search Odoo</Button>
              </div>
            </form>
          </div>

          <div className="odoo-progressive-mapping__list odoo-progressive-mapping-list" aria-label="Truck mapping list">
            {vehicles.map((item) => {
              const asset = item.asset || item;
              const status = item.mappingStatus || item.status;
              const currentValue = vehicleDrafts[asset.id]
                ?? (status === "ignored" ? "__ignored" : item.mapping?.externalId)
                ?? item.suggestion?.externalId
                ?? "";
              const helperId = `odoo-progressive-vehicle-helper-${asset.id}`;
              return (
                <div className={`odoo-progressive-mapping__row ${status === "mapped" || status === "ignored" ? "" : "needs-review"}`} key={asset.id}>
                  <span><strong>{vehicleLabel(asset)}</strong><small>{vehicleDetails(asset)}</small></span>
                  <div>
                    <input
                      aria-describedby={helperId}
                      aria-label={`Odoo vehicle ID for ${vehicleLabel(asset)}`}
                      disabled={busyKey === `vehicle-${asset.id}`}
                      list={`odoo-progressive-vehicle-candidates-${asset.id}`}
                      onChange={(event) => onVehicleDraftChange?.(asset.id, event.target.value)}
                      placeholder="Odoo vehicle ID"
                      value={currentValue}
                    />
                    <datalist id={`odoo-progressive-vehicle-candidates-${asset.id}`}>
                      {uniqueVehicleChoices(item, odooVehicleOptions).map((candidate) => <option key={candidate.externalId} value={candidate.externalId}>{candidate.name || "Odoo vehicle"} · VIN {candidate.vin || "not recorded"} · Plate {candidate.licensePlate || "not recorded"}{candidate.assigned ? " · Already assigned" : ""}</option>)}
                      <option value="__ignored">Ignore this unit for Odoo outbound</option>
                    </datalist>
                    <small id={helperId}>{vehicleHelper(item, status, vehicleSuggestionLabel)}</small>
                  </div>
                  <Button aria-label={`Confirm Odoo vehicle for ${vehicleLabel(asset)}`} disabled={busyKey === `vehicle-${asset.id}`} onClick={() => onConfirmVehicle?.(item)}>Confirm</Button>
                </div>
              );
            })}
            {!vehicles.length ? <p className="odoo-progressive-mapping__empty">No truck mappings match this view.</p> : null}
          </div>
          <div className="odoo-progressive-mapping__actions">
            {vehicleNextCursor ? <Button onClick={() => onLoadMoreVehicles?.()}>Load more trucks</Button> : null}
            <Button onClick={revealWarehouses} variant="secondary">Continue to location mapping</Button>
          </div>
        </div>
      </section>

      <section className="odoo-progressive-mapping__section" aria-labelledby="odoo-progressive-warehouse-heading" data-active={activeStep === "warehouses"}>
        <div className="odoo-progressive-mapping__section-header">
          <div>
            <p className="odoo-progressive-mapping__step">Step 2</p>
            <h4 id="odoo-progressive-warehouse-heading" ref={warehouseHeadingRef} tabIndex="-1">Location to warehouse mappings</h4>
            <p>Choose the Odoo warehouse for each app location. Each warehouse can be used once.</p>
            <small>{warehouseCountLabel} · Needs review: {warehouseNeedsReview}</small>
          </div>
          <button
            aria-controls="odoo-progressive-warehouse-panel"
            aria-expanded={warehouseExpanded}
            className="odoo-progressive-mapping__toggle"
            onClick={() => { setActiveStep("warehouses"); setWarehouseExpanded((current) => !current); }}
            type="button"
          >
            {warehouseExpanded ? "Collapse" : "Show locations"}
            {warehouseExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </button>
        </div>

        <div className="odoo-progressive-mapping__panel" hidden={!warehouseExpanded} id="odoo-progressive-warehouse-panel">
          <div className="odoo-progressive-mapping__list odoo-progressive-mapping-list" aria-label="Location to warehouse mapping list">
            {warehouses.map((item) => {
              const location = item.location || item;
              const currentValue = warehouseDrafts[location.id] ?? item.mapping?.externalId ?? "";
              const choices = item.candidates || warehouseOptions;
              return (
                <div className={`odoo-progressive-mapping__row ${(item.mappingStatus || item.status) === "mapped" ? "" : "needs-review"}`} key={location.id}>
                  <span><strong>{location.name}</strong><small>{[location.type, location.address].filter(Boolean).join(" · ") || "App location"}</small></span>
                  <select aria-label={`Odoo warehouse for ${location.name}`} disabled={busyKey === `warehouse-${location.id}`} onChange={(event) => onWarehouseDraftChange?.(location.id, event.target.value)} value={currentValue}>
                    <option value="">Not mapped</option>
                    {choices.map((warehouse) => <option disabled={warehouse.assigned && warehouse.externalId !== item.mapping?.externalId} key={warehouse.externalId} value={warehouse.externalId}>{warehouseLabel(warehouse)}</option>)}
                  </select>
                  <Button aria-label={`Confirm Odoo warehouse for ${location.name}`} disabled={busyKey === `warehouse-${location.id}`} onClick={() => onConfirmWarehouse?.(item)}>Confirm</Button>
                </div>
              );
            })}
            {!warehouses.length ? <p className="odoo-progressive-mapping__empty">No app locations are available for outbound warehouse matching.</p> : null}
          </div>
        </div>
      </section>
    </section>
  );
}
