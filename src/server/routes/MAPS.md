# Map configuration

`GET /api/config` exposes only browser-safe map configuration:

```json
{
  "maps": {
    "satelliteProvider": "arcgis",
    "hereBrowserApiKey": "",
    "googleMapsBrowserApiKey": ""
  }
}
```

## Provider selection

- `SATELLITE_MAP_PROVIDER` defaults to `arcgis`.
- Set `SATELLITE_MAP_PROVIDER=here` only after the HERE Raster Tile API is enabled.
- HERE is selected only when a browser key is also configured. Otherwise the
  API reports `arcgis`.
- The frontend may fall back from a failed HERE tile to ArcGIS World Imagery.

Browser keys are read from `NEXT_PUBLIC_HERE_API_KEY` or
`HERE_BROWSER_API_KEY`. The legacy `HERE_API_KEY` is exposed only when HERE is
explicitly selected. Google configuration is read only from
`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY`.

Do not put server integration credentials in browser-key variables. Samsara
tokens, OAuth secrets, and database credentials are never part of `/api/config`.

## Asset location

Live location refresh first loads the asset through the actor's authorized
company IDs. The subsequent update also includes the resolved `company_id` in
its SQL predicate as defense in depth. Latitude or longitude values of zero are
valid GPS coordinates.
