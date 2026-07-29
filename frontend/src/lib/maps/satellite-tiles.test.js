import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSatelliteTileLayer,
  MAX_SATELLITE_ZOOM,
  resolveSatelliteProvider,
} from "./satellite-tiles.js";

test("HERE is primary when its public browser key is configured", () => {
  assert.equal(resolveSatelliteProvider({
    satelliteProvider: "here",
    hereBrowserApiKey: "browser-key",
  }), "here");
  const layer = buildSatelliteTileLayer(
    { latitude: 34.0522, longitude: -118.2437 },
    { satelliteProvider: "here", hereBrowserApiKey: "browser-key" },
  );
  assert.equal(layer.provider, "here");
  assert.equal(layer.tiles.length, 15);
  assert.match(layer.tiles[0].src, /^https:\/\/maps\.hereapi\.com\//);
  assert.match(layer.tiles[0].fallbackSrc, /^https:\/\/server\.arcgisonline\.com\//);
});

test("HERE satellite tiles use higher-density images on Retina screens", () => {
  const layer = buildSatelliteTileLayer(
    { latitude: 34.0522, longitude: -118.2437 },
    { satelliteProvider: "here", hereBrowserApiKey: "browser-key" },
    19,
    { pixelRatio: 2 },
  );

  assert.equal(layer.tiles.every((tile) => tile.src.includes("size=512")), true);
  assert.equal(layer.tiles.every((tile) => tile.fallbackSrc.includes("arcgisonline.com")), true);
  assert.equal(layer.tiles.filter((tile) => tile.priority).length, 1);
});

test("ArcGIS fallback remains standard provider tiles", () => {
  const layer = buildSatelliteTileLayer(
    { latitude: 34.0522, longitude: -118.2437 },
    { satelliteProvider: "arcgis" },
    19,
    { pixelRatio: 2 },
  );

  assert.equal(layer.tiles.every((tile) => tile.src.includes("arcgisonline.com")), true);
  assert.equal(layer.tiles.every((tile) => !tile.src.includes("size=512")), true);
});

test("ArcGIS is used when HERE is unavailable", () => {
  const layer = buildSatelliteTileLayer(
    { latitude: 34.0522, longitude: -118.2437 },
    { satelliteProvider: "here", hereBrowserApiKey: "" },
  );
  assert.equal(layer.provider, "arcgis");
  assert.equal(layer.tiles.every((tile) => tile.fallbackSrc === ""), true);
  assert.equal(layer.tiles.every((tile) => tile.src.includes("arcgisonline.com")), true);
});

test("fractional tile position moves the real GPS point to the viewport center", () => {
  const layer = buildSatelliteTileLayer(
    { latitude: 34.0522, longitude: -118.2437 },
    { satelliteProvider: "arcgis" },
  );
  const xShift = Number.parseFloat(layer.layerStyle["--map-layer-x"]);
  const yShift = Number.parseFloat(layer.layerStyle["--map-layer-y"]);
  assert.ok(xShift < -40 && xShift > -60);
  assert.ok(yShift < -33.333 && yShift > -66.667);
});

test("valid zero coordinates produce a tile layer", () => {
  const layer = buildSatelliteTileLayer(
    { latitude: 0, longitude: 0 },
    { satelliteProvider: "arcgis" },
  );
  assert.equal(layer.tiles.length, 15);
});

test("invalid coordinates do not produce a tile layer", () => {
  assert.equal(buildSatelliteTileLayer({ latitude: "missing", longitude: 0 }), null);
});

test("asset-level zoom is preserved across HERE and fallback tile URLs", () => {
  const hereLayer = buildSatelliteTileLayer(
    { latitude: 34.0522, longitude: -118.2437 },
    { satelliteProvider: "here", hereBrowserApiKey: "browser-key" },
    19,
  );
  assert.equal(hereLayer.tiles.every((tile) => tile.key.startsWith("19-")), true);
  assert.equal(hereLayer.tiles.every((tile) => tile.src.includes("/mc/19/")), true);
  assert.equal(hereLayer.tiles.every((tile) => tile.fallbackSrc.includes("/tile/19/")), true);
});

test("embedded satellite maps cap at provider-safe zoom", () => {
  assert.equal(MAX_SATELLITE_ZOOM, 19);

  const layer = buildSatelliteTileLayer(
    { latitude: 34.0522, longitude: -118.2437 },
    { satelliteProvider: "arcgis" },
    20,
  );

  assert.equal(layer.tiles.every((tile) => tile.key.startsWith("19-")), true);
  assert.equal(layer.tiles.every((tile) => tile.src.includes("/tile/19/")), true);
});
