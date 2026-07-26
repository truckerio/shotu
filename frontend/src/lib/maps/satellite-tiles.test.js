import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHereLocationUrl,
  buildSatelliteTileLayer,
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

test("HERE location links preserve exact coordinates and satellite view", () => {
  assert.equal(
    buildHereLocationUrl({ latitude: 34.012345, longitude: -117.654321 }),
    "https://share.here.com/l/34.012345,-117.654321?z=17&t=satellite&p=yes&ref=shotu",
  );
  assert.equal(buildHereLocationUrl({ latitude: "missing", longitude: -117 }), "");
});
