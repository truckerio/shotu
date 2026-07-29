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
const componentCss = readFileSync(
  new URL("../../components/workorders/asset-location-card.css", import.meta.url),
  "utf8",
);

test("shared asset map stays open on desktop while mobile keeps its reveal controller", () => {
  assert.match(component, /const DESKTOP_MAP_QUERY = "\(min-width: 701px\)"/);
  assert.match(component, /desktopMapOpen \|\| mapOpen \|\| mapPinned/);
  assert.match(component, /desktopMapOpen \|\| mapContentMounted/);
  assert.match(component, /if \(desktopMapOpen \|\| event\.pointerType !== "mouse"/);
  assert.match(component, /createMapVisibilityController/);
});

test("shared asset map and HERE handoff use precise asset-level zoom", () => {
  assert.match(component, /const ASSET_LOCATION_ZOOM = 19/);
  assert.match(
    component,
    /buildSatelliteTileLayer\(location, mapsConfig, mapZoom\)/,
  );
  assert.match(component, /buildHereLocationUrl\(location, mapZoom\)/);
});

test("shared map exposes bounded zoom controls", () => {
  assert.match(component, /const MIN_ASSET_LOCATION_ZOOM = 17/);
  assert.match(component, /const MAX_ASSET_LOCATION_ZOOM = 20/);
  assert.match(component, /aria-label="Zoom in"/);
  assert.match(component, /aria-label="Zoom out"/);
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

test("detail pages place the shared asset map in Review and mechanic Work", () => {
  assert.match(detailSections, /const detailMapVehicle = selectedVehicle \|\| mechanicMapVehicle/);
  assert.match(detailSections, /const detailMapLocation = getVehicleLocation\(selectedVehicle\) \|\| mechanicMapLocation/);
  assert.equal(detailSections.match(/<AssetLocationCard/g)?.length, 2);
  assert.doesNotMatch(detailSections, /<dl className="workorder-readonly-details">[\s\S]*?<AssetLocationCard/);
});
