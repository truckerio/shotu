# Additive Mechanic Kiosk Mode

## Title and Metadata

- **Author:** Codex with product direction from Karan
- **Date:** 2026-07-28
- **Status:** Approved
- **Reviewers:** Karan
- **Target:** Workorder Generator web application

## Context

Mechanics share a shop computer and need faster access than repeated username/password entry. Shared credentials are unacceptable because workorder actions must remain attributable to an individual mechanic.

Kiosk mode is additive. Existing standard login MUST remain available and unchanged for personal devices and for Admin, Manager/office, Surveillance, and mechanics. A registered shop browser MAY enter kiosk mode, show a location-scoped mechanic roster, and authenticate a selected mechanic with a private numeric PIN containing at least four digits.

## Functional Requirements

- FR-1: Application MUST preserve existing username/email and password login.
- FR-2: An authenticated Admin MUST be able to register current browser as a kiosk for one authorized location.
- FR-3: A registered kiosk MUST be represented by a high-entropy device credential whose plaintext exists only in a secure browser cookie.
- FR-4: Admin MUST be able to list and revoke registered kiosks for an authorized location.
- FR-5: Registered kiosk entry MUST show only active mechanics with active membership in kiosk location and company.
- FR-6: Roster MUST expose only mechanic ID, display name, and generated initials.
- FR-7: Admin MUST be able to enable or reset a temporary numeric kiosk PIN for an active mechanic.
- FR-8: PIN MUST be one-time when issued by Admin and MUST require replacement after first successful kiosk authentication.
- FR-9: Kiosk unlock MUST validate device credential, device state, mechanic eligibility, PIN, and lockout state on server.
- FR-10: Successful kiosk unlock MUST create normal Better Auth session for selected mechanic.
- FR-11: Existing role routing, authorization, work queues, and workorder components MUST handle kiosk-created mechanic session.
- FR-12: Kiosk session MUST retain device and location context for audit and client behavior.
- FR-13: Mechanic MUST be able to switch mechanic, ending current user session while retaining kiosk registration.
- FR-14: Kiosk MUST offer standard login without deleting device registration.
- FR-15: Standard authenticated session on registered device MUST offer return to kiosk mode through sign-out/switch behavior.
- FR-16: Revoked, missing, expired, or inactive device MUST fall back to standard login.
- FR-17: Kiosk session MUST auto-lock after two minutes without pointer, keyboard, touch, input, focus, or visibility activity.
- FR-18: PIN failures MUST be rate-limited and MUST produce generic errors.
- FR-19: System MUST audit device registration, revocation, PIN issue/reset/change, unlock success, unlock failure, session lock, and mechanic switch.
- FR-20: Mechanic assigned to multiple locations MUST appear on each registered kiosk for an assigned location and use same company-scoped PIN.
- FR-21: Kiosk setup MUST be optional per browser and MUST NOT automatically convert all devices at a location.
- FR-22: Demo seed/setup tooling MUST support safe creation of a demo location, mechanic, PIN, and kiosk registration without embedding production credentials.
- FR-23: Location Users MUST be the single Admin surface for viewing mechanic kiosk PIN status and setting or resetting a temporary PIN.
- FR-24: The Kiosk location tab MUST manage registered shop computers only and MUST NOT duplicate user PIN assignment.

## Non-Functional Requirements

- NFR-1 Security: Device credential MUST contain at least 256 bits of entropy; database MUST store SHA-256 hash only.
- NFR-2 Security: Device cookie MUST be HttpOnly, SameSite=Strict, path `/`, and Secure in production.
- NFR-3 Security: PIN MUST contain at least four digits without a fixed maximum length in the UI and use Better Auth scrypt password hashing. Simple values such as `0000` MAY be issued as temporary onboarding PINs because first unlock requires a different replacement PIN.
- NFR-4 Security: Five failures within fifteen minutes MUST lock mechanic-device pair for fifteen minutes.
- NFR-5 Security: Unlock endpoint MUST also use process-level IP/device throttling and same-origin mutation protection.
- NFR-6 Security: Revocation MUST invalidate subsequent roster and unlock calls immediately.
- NFR-7 Privacy: Roster MUST NOT return email, username, phone, company memberships, or permissions.
- NFR-8 Compatibility: Existing auth session schema and public standard login contract MUST remain backward compatible.
- NFR-9 Accessibility: Kiosk controls MUST support keyboard navigation, visible focus, accessible names, status announcements, and 44px minimum touch targets.
- NFR-10 Responsive: Kiosk and Admin device surfaces MUST have no horizontal overflow at 390x844 and 430x932.
- NFR-11 Performance: Kiosk context and roster response SHOULD complete within 500ms under normal local database load.
- NFR-12 Reliability: Missing network or database failure MUST fail closed and retain standard-login escape when possible.
- NFR-13 Maintainability: Kiosk backend MUST use isolated repository, service, schema, plugin, and route modules; frontend MUST use shared kiosk components rather than role copies.

## Acceptance Criteria

### AC-1: Standard login preserved (FR-1, FR-14)
Given an unregistered or revoked browser, when application opens, then existing Sign in form renders and authenticates normally. References FR-1 and FR-14.

### AC-2: Browser registration (FR-2, FR-3, FR-21)
Given Admin and authorized location, when registering current browser, then active device row is created, only credential hash is stored, secure kiosk cookie is set, and no other browser changes mode. References FR-2, FR-3, FR-21, NFR-1, and NFR-2.

### AC-3: Revocation (FR-4, FR-16)
Given registered device, when Admin revokes it, then next kiosk context request reports unregistered and standard login renders. References FR-4 and FR-16.

### AC-4: Eligible roster (FR-5, FR-6, FR-20)
Given location with eligible and ineligible users, when roster loads, then only active assigned mechanics appear with minimal fields. References FR-5, FR-6, FR-20, and NFR-7.

### AC-5: Temporary PIN (FR-7, FR-8)
Given active mechanic, when Admin issues temporary PIN, then `0000` and other numeric values of at least four digits are accepted, only a scrypt hash is stored, the prior PIN stops working, and first unlock requires a different replacement PIN. References FR-7, FR-8, and NFR-3.

### AC-6: Mechanic session (FR-9, FR-10, FR-11, FR-12)
Given registered device and eligible mechanic with valid PIN, when unlock succeeds, then Better Auth session resolves through `/api/me` as mechanic and existing mechanic workspace renders. References FR-9, FR-10, FR-11, and FR-12.

### AC-7: Mechanic switching (FR-13, FR-15)
Given kiosk mechanic session, when Switch mechanic is selected, then user session ends, device remains registered, and roster returns. References FR-13 and FR-15.

### AC-8: Inactivity lock (FR-17)
Given kiosk mechanic session with two minutes inactivity, when timer expires, then session signs out and kiosk roster returns. References FR-17.

### AC-9: Brute-force lockout (FR-18)
Given repeated wrong PIN, when fifth failure occurs, then pair locks for fifteen minutes, generic response is returned, and valid PIN cannot unlock until lock expires or Admin reset. References FR-18, NFR-4, and NFR-5.

### AC-10: Audit trail (FR-19)
Given kiosk lifecycle actions, when queried in database, then corresponding audit events exist without raw credential or PIN. References FR-19.

### AC-11: Responsive accessibility
Given 390x844 and 430x932 viewport, when kiosk roster, PIN entry, and Admin device panel render, then document width equals viewport width, touch targets are at least 44px, and keyboard focus reaches all actions. References NFR-9 and NFR-10.

### AC-12: Demo flow (FR-22)
Given local demo database, when demo kiosk setup runs, then browser can be registered and demo mechanic can complete real roster to PIN to mechanic queue flow. References FR-22.

### AC-13: Regression safety
Given existing standard users, when full verification runs, then prior auth, Admin, role routing, and workorder tests remain passing. References NFR-8.

## Operations

- Admin PIN issue fields default to `0000`; Admin MAY replace that value before issuing.
- Every Admin-issued PIN remains temporary. First successful unlock requires the mechanic to choose a different PIN.
- `npm run kiosk:pins:reset` is dry-run by default and reports only the eligible active-mechanic count.
- Production reset requires both `--apply` and `--confirm=RESET_ALL_ACTIVE_MECHANIC_KIOSK_PINS`.
- The bulk reset creates a unique scrypt hash for each mechanic, clears prior kiosk unlock failures, marks every credential for first-use replacement, and writes one audit event per mechanic. It never prints PINs or hashes.

## Edge Cases

- EC-1: Device cookie missing, malformed, unknown, expired, or revoked returns unregistered context without distinguishing cause.
- EC-2: Mechanic becomes inactive or loses location/company membership between roster and unlock; unlock fails generically.
- EC-3: PIN credential missing, locked, or replaced between attempts; unlock fails generically.
- EC-4: Concurrent successful unlocks create independent sessions but retain same device audit attribution.
- EC-5: Mechanic deletion cascades PIN credential while historical audit retains nullable identity.
- EC-6: Location deactivation prevents kiosk use.
- EC-7: Admin attempts to issue PIN for non-mechanic or cross-company user; operation returns not found/invalid without leaking target.
- EC-8: Duplicate device name is allowed because device ID is identity.
- EC-9: Database failure during session creation does not reset failure counters incorrectly or issue partial cookie.
- EC-10: Standard sign-in on registered kiosk remains possible and does not remove kiosk cookie.
- EC-11: Multiple tabs observe signed-out session and return to kiosk on refresh/session update.
- EC-12: Pending mutation during inactivity delays client lock until request settles or bounded grace ends.

## API Contracts

```ts
interface KioskMechanic {
  id: string;
  name: string;
  initials: string;
  requiresPinChange: boolean;
}

type KioskContextResponse =
  | { registered: false }
  | {
      registered: true;
      device: { id: string; name: string; locationId: string; locationName: string };
      mechanics: KioskMechanic[];
    };

GET /api/kiosk/context -> KioskContextResponse

POST /api/auth/kiosk/unlock
body: { mechanicId: string; pin: string; newPin?: string }
success: { user: { id: string; name: string }; requiresPinChange: false }
errors: 400 invalid input | 401 generic invalid credentials | 423 generic locked | 429 throttled

POST /api/kiosk/event
body: { type: "lock" | "switch" }
success: { recorded: true }

GET /api/admin/locations/:locationId/kiosk-devices
success: { devices: Array<{ id: string; name: string; active: boolean; createdAt: string; lastSeenAt: string | null }> }

POST /api/admin/locations/:locationId/kiosk-devices/register
body: { name: string }
success 201: { device: { id: string; name: string; active: true } } plus HttpOnly cookie

POST /api/admin/locations/:locationId/kiosk-devices/:deviceId/revoke
success: { device: { id: string; active: false } }

POST /api/admin/locations/:locationId/users/:userId/kiosk-pin
body: { pin: string }
success: { credential: { enabled: true; requiresChange: true; updatedAt: string } }
```

All mutation errors use existing `{ error: string, code?: string }` shape.

The location detail user projection includes only safe kiosk credential metadata:
`kiosk_pin_set`, `kiosk_pin_requires_change`, and `kiosk_pin_updated_at`. It never
returns `pin_hash` or the plaintext PIN. Admin sets or resets a mechanic PIN from
the location Users tab; the Kiosk tab is reserved for browser registration and
revocation.

## Data Models

### `kiosk_devices`

| Field | Type | Constraints |
|---|---|---|
| id | uuid | primary key |
| company_id | uuid | required, company FK |
| location_id | uuid | required, location FK |
| name | text | required, 1-80 chars |
| token_hash | text | required, unique, 64-char SHA-256 |
| active | boolean | required, default true |
| registered_by_user_id | uuid | required, app user FK |
| last_seen_at | timestamptz | nullable |
| revoked_at | timestamptz | nullable |
| revoked_by_user_id | uuid | nullable app user FK |
| created_at | timestamptz | required |
| updated_at | timestamptz | required |

### `mechanic_kiosk_credentials`

| Field | Type | Constraints |
|---|---|---|
| user_id | uuid | primary key component, app user FK cascade |
| company_id | uuid | primary key component, company FK |
| pin_hash | text | required scrypt hash |
| requires_change | boolean | required, default true |
| version | integer | required, positive |
| updated_by_user_id | uuid | nullable app user FK |
| created_at | timestamptz | required |
| updated_at | timestamptz | required |

### `kiosk_unlock_failures`

| Field | Type | Constraints |
|---|---|---|
| device_id | uuid | primary key component, device FK cascade |
| user_id | uuid | primary key component, app user FK cascade |
| failure_count | integer | required |
| window_started_at | timestamptz | required |
| locked_until | timestamptz | nullable |
| updated_at | timestamptz | required |

### `kiosk_session_context`

| Field | Type | Constraints |
|---|---|---|
| session_id | text | primary key, auth session FK cascade |
| device_id | uuid | required, device FK |
| location_id | uuid | required, location FK |
| authenticated_at | timestamptz | required |

### `kiosk_audit_events`

| Field | Type | Constraints |
|---|---|---|
| id | uuid | primary key |
| company_id | uuid | required, company FK |
| location_id | uuid | nullable |
| device_id | uuid | nullable |
| actor_user_id | uuid | nullable |
| target_user_id | uuid | nullable |
| event_type | text | required allowlist |
| metadata | jsonb | required, no secrets |
| created_at | timestamptz | required |

## Out of Scope

- OS-1: Offline PIN authentication; rejected because local verifier increases credential theft risk.
- OS-2: Biometric, badge, QR, NFC, passkey, or facial authentication.
- OS-3: Kiosk access for Admin, Manager/office, or Surveillance; standard login remains required.
- OS-4: Native mobile application or operating-system kiosk lockdown.
- OS-5: Global conversion of location devices into kiosks.
- OS-6: Shared mechanic identity or anonymous work attribution.
- OS-7: Production data mutation during demo validation.
