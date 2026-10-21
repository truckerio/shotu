# Map configuration

`GET /api/config` exposes only browser-safe map configuration:

```json
{
  "maps": {
    "satelliteProvider": "here",
    "hereBrowserApiKey": "browser-restricted-key",
    "googleMapsBrowserApiKey": ""
  }
}
```

## Provider selection

- HERE is selected when a browser-safe HERE key is configured.
- Set `SATELLITE_MAP_PROVIDER=arcgis` only when HERE must be disabled.
- If no browser key is configured, the API reports `arcgis`.
- The frontend falls back from a failed HERE tile to ArcGIS World Imagery.
- Visible map tiles load eagerly and prioritize the center GPS tile for faster
  first paint.

Browser keys are read from `NEXT_PUBLIC_HERE_API_KEY` or
`HERE_BROWSER_API_KEY`. The legacy `HERE_API_KEY` is supported for existing
deployments but should be treated as a browser-exposed key when used here.
Google configuration is read only from
`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY`.

Do not put server integration credentials in browser-key variables. Samsara
tokens, OAuth secrets, and database credentials are never part of `/api/config`.

## Asset location

Live location refresh first loads the asset through the actor's authorized
company IDs. The subsequent update also includes the resolved `company_id` in
its SQL predicate as defense in depth. Latitude or longitude values of zero are
valid GPS coordinates.

## Inspection business-address suggestions

Inspection creation always supports manual business addresses. Saved customer
addresses prefill the field; editing or clearing applies only to that report.

To enable optional Google suggestions, set
`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY` on the server and restart it. Enable
Maps JavaScript API and Places API (New) in that key's Google Cloud project,
and restrict the browser key to the application's HTTP referrers and required
APIs. No server-side Google secret is needed.

The field loads the Places library on demand, debounces input, uses a session
token, and requests only the selected place's formatted address. Missing keys,
SDK failures, or unavailable suggestions never prevent manual entry. Google
addresses are stored only after the user selects and submits them as part of
an inspection.

Provider behavior and setup: [Google Place Autocomplete Data API](https://developers.google.com/maps/documentation/javascript/place-autocomplete-data).
