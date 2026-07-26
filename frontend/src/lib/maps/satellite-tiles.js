const MAX_MERCATOR_LATITUDE = 85.05112878;
const DEFAULT_ZOOM = 17;
const GRID_COLUMNS = 5;
const GRID_ROWS = 3;
const CENTER_COLUMN = Math.floor(GRID_COLUMNS / 2);
const CENTER_ROW = Math.floor(GRID_ROWS / 2);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function wrapTileX(value, tileCount) {
  return ((value % tileCount) + tileCount) % tileCount;
}

function projectToTile(latitude, longitude, zoom) {
  const tileCount = 2 ** zoom;
  const normalizedLongitude = ((longitude + 180) % 360 + 360) % 360 - 180;
  const clampedLatitude = clamp(latitude, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  const latitudeRadians = (clampedLatitude * Math.PI) / 180;
  const x = ((normalizedLongitude + 180) / 360) * tileCount;
  const y = (
    1
    - Math.asinh(Math.tan(latitudeRadians)) / Math.PI
  ) / 2 * tileCount;
  return { tileCount, x, y };
}

function arcgisTileUrl(zoom, x, y) {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;
}

function hereTileUrl(apiKey, zoom, x, y) {
  return `https://maps.hereapi.com/v3/base/mc/${zoom}/${x}/${y}/jpeg?style=satellite.day&size=256&apiKey=${encodeURIComponent(apiKey)}`;
}

export function resolveSatelliteProvider(mapsConfig = {}) {
  const configuredProvider = String(mapsConfig.satelliteProvider || "").trim().toLowerCase();
  if (configuredProvider === "here" && mapsConfig.hereBrowserApiKey) return "here";
  if (configuredProvider === "arcgis") return "arcgis";
  return mapsConfig.hereBrowserApiKey ? "here" : "arcgis";
}

export function buildHereLocationUrl(location, zoom = DEFAULT_ZOOM) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  const safeZoom = clamp(Math.round(Number(zoom) || DEFAULT_ZOOM), 0, 20);
  return `https://share.here.com/l/${latitude},${longitude}?z=${safeZoom}&t=satellite&p=yes&ref=shotu`;
}

export function buildSatelliteTileLayer(location, mapsConfig = {}, zoom = DEFAULT_ZOOM) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const safeZoom = clamp(Math.round(Number(zoom) || DEFAULT_ZOOM), 1, 20);
  const projected = projectToTile(latitude, longitude, safeZoom);
  const centerTileX = Math.floor(projected.x);
  const centerTileY = Math.floor(projected.y);
  const fractionX = projected.x - centerTileX;
  const fractionY = projected.y - centerTileY;
  const provider = resolveSatelliteProvider(mapsConfig);
  const hereKey = provider === "here" ? mapsConfig.hereBrowserApiKey : "";
  const tiles = [];

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let column = 0; column < GRID_COLUMNS; column += 1) {
      const x = wrapTileX(centerTileX + column - CENTER_COLUMN, projected.tileCount);
      const y = clamp(centerTileY + row - CENTER_ROW, 0, projected.tileCount - 1);
      const fallbackSrc = arcgisTileUrl(safeZoom, x, y);
      tiles.push({
        key: `${safeZoom}-${x}-${y}`,
        src: hereKey ? hereTileUrl(hereKey, safeZoom, x, y) : fallbackSrc,
        fallbackSrc: hereKey ? fallbackSrc : "",
      });
    }
  }

  return {
    provider,
    attribution: provider === "here" ? "HERE" : "Esri, Maxar, Earthstar Geographics",
    tiles,
    layerStyle: {
      "--map-layer-x": `${-((CENTER_COLUMN + fractionX) / GRID_COLUMNS) * 100}%`,
      "--map-layer-y": `${-((CENTER_ROW + fractionY) / GRID_ROWS) * 100}%`,
    },
  };
}
