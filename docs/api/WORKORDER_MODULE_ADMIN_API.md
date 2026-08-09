# Workorder Module Admin API

This is the implemented Admin API for the Workorder Module Platform V2. All
routes require an authenticated Admin and enforce the actor's company scope.
The canonical catalog is server-owned; clients must not duplicate module keys,
supported surfaces, actions, or safe defaults.

## Catalog

```http
GET /api/admin/module-catalog
```

Response:

```json
{
  "catalog": {
    "version": 1,
    "roles": ["mechanic", "office", "surveillance", "admin"],
    "surfaces": ["create", "detail"],
    "modules": [
      {
        "key": "activity",
        "owner": "workorders.activity",
        "label": "Activity",
        "surfaces": ["detail"],
        "capabilities": ["read"],
        "actions": []
      }
    ]
  }
}
```

The Admin UI may offer Edit only when `capabilities` contains `write`. Admins
may grant a writable module to any role or named user; runtime action controls
remain limited to the module's declared actions plus resource and lifecycle
authorization.

## Company defaults

```http
GET /api/admin/companies/:companyId/module-policy
PATCH /api/admin/companies/:companyId/module-policy
```

PATCH request:

```json
{
  "moduleAccess": {
    "office": { "detail": { "odoo": "read" } }
  },
  "userModuleAccess": {
    "2a94cf43-2f53-4db7-85ec-e05d527dd863": {
      "detail": { "odoo": "write" }
    }
  },
  "expectedVersion": 3
}
```

Response contains the normalized sparse policy and its new `version`. A stale
`expectedVersion` returns HTTP `409` with code
`WORKORDER_MODULE_POLICY_CONFLICT`. The Modules page reloads the authoritative
policy and asks the Admin to review before retrying.

## Location overrides

```http
GET /api/admin/locations/:locationId/workorder-policy
PATCH /api/admin/locations/:locationId/workorder-policy
```

PATCH request:

```json
{
  "mechanicCanRecordParts": false,
  "moduleAccess": {
    "office": { "detail": { "odoo": "write" } }
  },
  "userModuleAccess": {},
  "expectedVersion": 3
}
```

The response includes both `moduleAccessOverrides` (the sparse location values)
and `moduleAccess` (the compatibility normalized map). The Admin client must
submit the sparse map. A stale location version returns the same HTTP `409`
conflict as a stale company version.

## Canonical rule adapters

```http
GET   /api/admin/module-access?companyId=:companyId&locationId=<optional>
GET   /api/admin/module-access/users/:userId?companyId=:companyId&locationId=<optional>
PATCH /api/admin/module-access/roles/:role
PATCH /api/admin/module-access/users/:userId
```

PATCH accepts one normalized rule and its scope/version:

```json
{
  "companyId": "e253c81e-a25f-41d2-849c-3470d4c13764",
  "locationId": null,
  "surface": "create",
  "moduleKey": "concern",
  "access": "write",
  "required": true,
  "expectedVersion": 3
}
```

These are the canonical adapters for external Admin clients changing one rule.
The first-party Modules page keeps an explicit Save button and uses the bulk
scope PATCH so several draft changes commit or conflict together. Both API
shapes delegate to the same normalized policy owner and compatibility
projection.

## Access values and reset behavior

- `hidden`: Off.
- `read`: View.
- `write`: Edit, only for a server-declared write-capable module.
- `required`: compatibility storage for the separate **Required to create**
  setting; it is not an access-menu choice.
- A missing sparse key means inherit. Removing a company key restores the
  system default; removing a location key restores the company setting;
  removing a user key restores the matching role setting.

Effective precedence is location user, company user, location role, company
role, then built-in safe default.

## Administrative audit seam

After a successful bulk policy save or canonical role/user rule patch, the Admin service builds at
most one `policy.module_access.changed` envelope. It includes actor, company,
optional location, scope, request ID, timestamp, and all changed role/user,
module, surface, before, and after values. No-op requests emit nothing; failed
saves and background GETs emit nothing.

The adapter accepts `emitAdministrativeAuditEvent` from the server route helper.
The server binds it to the shared structured JSON event logger, so production
does not silently discard successful policy events. Audit storage, retention,
export, and UI are intentionally not implemented by the module-policy feature;
the future audit owner can consume and persist the same envelope.

## Status codes

| Status | Meaning |
| --- | --- |
| `200` | Catalog or policy read/save succeeded |
| `400` | Invalid module, surface, access value, or body |
| `401` | Not authenticated |
| `403` | Not an Admin or outside the actor's company scope |
| `404` | Company/location resource not found in the authorized scope |
| `409` | Stale company or location policy version |
