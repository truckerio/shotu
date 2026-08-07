import { ChevronDown } from "@untitledui/icons";
import { Button } from "../../../components/ui/Button.jsx";
import "./odoo-progressive-mapping.css";

function vehicleLabel(asset = {}) {
  return asset.unitNo || asset.name || "Unnamed unit";
}

function vehicleDetails(asset = {}) {
  return [asset.unitType, asset.vin && `VIN ${asset.vin}`, asset.licensePlate && `Plate ${asset.licensePlate}`]
    .filter(Boolean)
    .join(" · ");
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

export function OdooProgressiveMapping({
  vehicles = [],
  vehicleSummary = null,
  vehicleDrafts = {},
  odooVehicleOptions = [],
  vehicleQuery = "",
  odooVehicleQuery = "",
  warehouses = [],
  warehouseSummary = null,
  warehouseOptions = [],
  warehouseDrafts = {},
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
  const vehicleNeedsReview = vehicleSummary?.unresolvedCount
    ?? vehicles.filter((item) => !["mapped", "ignored"].includes(item.mappingStatus || item.status)).length;
  const warehouseNeedsReview = warehouseSummary?.unresolvedCount
    ?? warehouses.filter((item) => (item.mappingStatus || item.status) !== "mapped").length;
  const vehicleConfirmed = vehicleSummary?.confirmedCount
    ?? vehicles.filter((item) => (item.mappingStatus || item.status) === "mapped").length;
  const warehouseConfirmed = warehouseSummary?.confirmedCount
    ?? warehouses.filter((item) => (item.mappingStatus || item.status) === "mapped").length;

  return (
    <div className="odoo-settings-sections" aria-label="Odoo mapping settings">
      <details className="odoo-settings-section">
        <summary>
          <span className="odoo-settings-section__identity">
            <strong>Truck mapping</strong>
            <small>Match app units to their Odoo vehicles.</small>
          </span>
          <span className="odoo-settings-section__status">
            <span>{vehicleConfirmed} mapped</span>
            <span className={vehicleNeedsReview ? "needs-review" : "is-ready"}>{vehicleNeedsReview ? `${vehicleNeedsReview} to review` : "Ready"}</span>
            <ChevronDown aria-hidden="true" />
          </span>
        </summary>
        <div className="odoo-settings-section__body">
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

          <div className="odoo-progressive-mapping-list" aria-label="Truck mapping list">
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
          {vehicleNextCursor ? <Button onClick={() => onLoadMoreVehicles?.()}>Load more trucks</Button> : null}
        </div>
      </details>

      <details className="odoo-settings-section">
        <summary>
          <span className="odoo-settings-section__identity">
            <strong>Location mapping</strong>
            <small>Connect each app location to its Odoo warehouse.</small>
          </span>
          <span className="odoo-settings-section__status">
            <span>{warehouseConfirmed} mapped</span>
            <span className={warehouseNeedsReview ? "needs-review" : "is-ready"}>{warehouseNeedsReview ? `${warehouseNeedsReview} to review` : "Ready"}</span>
            <ChevronDown aria-hidden="true" />
          </span>
        </summary>
        <div className="odoo-settings-section__body">
          <div className="odoo-progressive-mapping-list" aria-label="Location to warehouse mapping list">
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
            {!warehouses.length ? <p className="odoo-progressive-mapping__empty">No app locations are available for warehouse matching.</p> : null}
          </div>
        </div>
      </details>
    </div>
  );
}
