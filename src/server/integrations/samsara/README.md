# Samsara integration settings

All settings routes require `integration:admin`, except the public OAuth callback.
`companyId` is selected from the query string and checked against the authenticated
actor's company memberships.

## Routes

- `GET /api/integrations/samsara/status?companyId=<uuid>`
- `GET /api/integrations/samsara/oauth/start?companyId=<uuid>`
- `POST /api/integrations/samsara/test?companyId=<uuid>`
- `POST /api/integrations/samsara/sync?companyId=<uuid>`
- `DELETE /api/integrations/samsara?companyId=<uuid>`

Status and disconnect return:

```json
{
  "configured": true,
  "provider": "samsara",
  "authType": "oauth",
  "status": "connected",
  "lastFullSyncAt": "2026-07-25T12:00:00.000Z",
  "latestSync": {
    "id": "uuid",
    "type": "manual",
    "status": "completed",
    "startedAt": "2026-07-25T12:00:00.000Z",
    "finishedAt": "2026-07-25T12:01:00.000Z",
    "fetchedCount": 100,
    "changedCount": 12,
    "hasError": false
  }
}
```

The response never includes access tokens, refresh tokens, OAuth state, provider
error text, or raw provider data.

Disconnect is idempotent. It keeps the integration account and previous full-sync
timestamp, clears OAuth credentials and pending state, marks the account
`disconnected`, and appends a completed `disconnect` row to
`integration_sync_runs` in the same transaction. A later OAuth start replaces the
state and reconnects through the existing callback.

An environment API token cannot be removed through the application. For the
default company, status remains configured with `authType: "api_token"` after an
OAuth disconnect when `SAMSARA_API_TOKEN` is still set.
