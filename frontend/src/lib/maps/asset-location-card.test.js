import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../../components/workorders/AssetLocationCard.jsx", import.meta.url),
  "utf8",
);
const detailSections = readFileSync(
  new URL("../../features/workorder-detail/WorkorderDetailSections.jsx", import.meta.url),
  "utf8",
);
const locationModule = readFileSync(
  new URL("../../features/workorder-modules/location/WorkorderLocationModule.jsx", import.meta.url),
  "utf8",
);
const unitModule = readFileSync(
  new URL("../../features/workorder-modules/unit/WorkorderUnitModule.jsx", import.meta.url),
  "utf8",
);
const componentCss = readFileSync(
  new URL("../../components/workorders/asset-location-card.css", import.meta.url),
  "utf8",
);
const roleRouter = readFileSync(
  new URL("../../app/routes/RoleRouter.jsx", import.meta.url),
  "utf8",
);
const vehicleLookupController = readFileSync(
  new URL("../../features/create-workorder/useVehicleLookupController.js", import.meta.url),
  "utf8",
);

test("shared asset map stays open on desktop while mobile keeps its reveal controller", () => {
  assert.match(component, /const DESKTOP_MAP_QUERY = "\(min-width: 701px\)"/);
  assert.match(component, /desktopMapOpen \|\| mapOpen \|\| mapPinned/);
  assert.match(component, /desktopMapOpen \|\| mapContentMounted/);
  assert.match(component, /if \(desktopMapOpen \|\| event\.pointerType !== "mouse"/);
  assert.match(component, /createMapVisibilityController/);
});

test("shared asset map uses precise asset-level zoom without external handoff", () => {
  assert.match(component, /const ASSET_LOCATION_ZOOM = 19/);
  assert.match(
    component,
    /buildSatelliteTileLayer\(location, mapsConfig, mapZoom, \{ pixelRatio: mapPixelRatio \}\)/,
  );
  assert.doesNotMatch(component, /buildExternalMapUrl/);
  assert.doesNotMatch(component, /Open map|Open in HERE/);
  assert.match(component, /browserPixelRatio/);
  assert.match(component, /loading="eager"/);
  assert.match(component, /fetchPriority=\{tile\.priority \? "high" : "auto"\}/);
});

test("shared map exposes bounded zoom controls", () => {
  assert.match(component, /const MIN_ASSET_LOCATION_ZOOM = 17/);
  assert.match(component, /MAX_SATELLITE_ZOOM/);
  assert.doesNotMatch(component, /const MAX_ASSET_LOCATION_ZOOM = 20/);
  assert.match(component, /aria-label=\{t\("location\.zoomIn"\)\}/);
  assert.match(component, /aria-label=\{t\("location\.zoomOut"\)\}/);
  assert.match(componentCss, /@media \(max-width: 700px\)[\s\S]*?height: 44px;[\s\S]*?width: 44px;/);
});

test("shared map uses a taller responsive viewport without overflowing phones", () => {
  assert.match(
    componentCss,
    /\.asset-location-card\.is-map-visible \.asset-map-hover \{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;[\s\S]*?height: clamp\(390px, 36vw, 490px\);/,
  );
  assert.match(
    componentCss,
    /\.asset-location-card \.asset-map-tiles \{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-height: 320px;/,
  );
  assert.match(
    componentCss,
    /@media \(max-width: 700px\)[\s\S]*?\.asset-location-card \.asset-map-tiles \{[\s\S]*?aspect-ratio: 4 \/ 3;[\s\S]*?flex: none;[\s\S]*?height: auto;/,
  );
});

test("detail pages place the shared asset map in the owned Location module", () => {
  assert.match(detailSections, /const detailMapVehicle = selectedVehicle \|\| mechanicMapVehicle/);
  assert.match(detailSections, /const detailMapLocation = getVehicleLocation\(selectedVehicle\) \|\| mechanicMapLocation/);
  assert.match(detailSections, /location:[\s\S]*vehicle: detailMapVehicle/);
  assert.equal(locationModule.match(/<AssetLocationCard/g)?.length, 1);
  assert.doesNotMatch(unitModule, /<dl className="workorder-readonly-details">[\s\S]*?<AssetLocationCard/);
});

test("shared workorder details refresh live asset location on open and every minute", () => {
  assert.match(
    vehicleLookupController,
    /if \(!activeWorkorderId \|\| !selectedVehicle\?\.id\) \{[\s\S]*?detailLocationRefreshRef\.current = "";[\s\S]*?return;/,
  );
  assert.match(
    vehicleLookupController,
    /const refreshKey = `\$\{activeWorkorderId\}:\$\{selectedVehicle\.id\}`;/,
  );
  assert.match(
    vehicleLookupController,
    /api\(`\/api\/vehicles\/\$\{encodeURIComponent\(vehicle\.id\)\}\/live-location`, \{ method: "POST" \}\)/,
  );
  assert.match(
    roleRouter,
    /enabled: workspace === "generator" \|\| Boolean\(activeWorkorder\)/,
  );
  assert.match(vehicleLookupController, /intervalMs: 60_000/);
  assert.match(vehicleLookupController, /locationRequestRef\.current\.promise === request/);
  assert.doesNotMatch(vehicleLookupController, /isMechanicDetail/);
});
