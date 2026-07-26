import assert from "node:assert/strict";
import test from "node:test";
import { publicMapsConfig } from "./config.routes.js";
import { hasValidGpsCoordinates } from "../services/vehicles.service.js";

test("map config defaults to ArcGIS and does not expose an unused HERE key", () => {
  assert.deepEqual(
    publicMapsConfig({
      satelliteMapProvider: "arcgis",
      hereBrowserApiKey: "unused-here-key",
      googleMapsBrowserApiKey: "",
      samsaraApiToken: "server-secret",
    }),
    {
      satelliteProvider: "arcgis",
      hereBrowserApiKey: "",
      googleMapsBrowserApiKey: "",
    }
  );
});

test("map config selects HERE only after explicit opt-in with a browser key", () => {
  assert.deepEqual(
    publicMapsConfig({
      satelliteMapProvider: "here",
      hereBrowserApiKey: "browser-restricted-key",
      googleMapsBrowserApiKey: "",
    }),
    {
      satelliteProvider: "here",
      hereBrowserApiKey: "browser-restricted-key",
      googleMapsBrowserApiKey: "",
    }
  );

  assert.equal(
    publicMapsConfig({ satelliteMapProvider: "here", hereBrowserApiKey: "" }).satelliteProvider,
    "arcgis"
  );
});

test("GPS validation accepts valid zero coordinates and rejects missing values", () => {
  assert.equal(hasValidGpsCoordinates({ latitude: 0, longitude: 0 }), true);
  assert.equal(hasValidGpsCoordinates({ latitude: "0", longitude: "-118.25" }), true);
  assert.equal(hasValidGpsCoordinates({ latitude: null, longitude: 0 }), false);
  assert.equal(hasValidGpsCoordinates({ latitude: 0, longitude: "" }), false);
  assert.equal(hasValidGpsCoordinates({ latitude: "invalid", longitude: 0 }), false);
});
