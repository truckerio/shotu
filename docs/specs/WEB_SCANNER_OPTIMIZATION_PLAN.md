# Web Scanner Optimization Plan

**Status:** Proposed
**Mode:** Plan only
**Primary delivery:** Optimized web scanner
**Native escalation:** Evidence-triggered proof of concept only
**Estimated implementation:** 5–8 engineering days plus physical-device access

## 1. Decision

Build one polished, optimized web scanner before creating a phone app.

Do not include PWA packaging, Capacitor, mobile authentication, App Store or Play Store delivery, offline inventory mutation, or Zebra integration in this delivery.

The current React application, authenticated server resolution, exact-unit authorization, and serialized-part lifecycle remain canonical. Native camera work begins only when physical-device evidence shows that the optimized browser scanner cannot meet the acceptance gates in this plan.

## 2. Problem

The current failure state can render a nearly empty solid background with manual entry anchored near the bottom. Every camera startup failure becomes the same generic message, so the operator cannot distinguish denied permission, missing camera, busy hardware, unsupported browser behavior, or rejected constraints.

The current camera request asks only for the environment-facing camera. Continuous autofocus is requested when supported, but camera capabilities, center focus, zoom, torch, error-specific recovery, and optimized frame scheduling are not fully used.

Browser camera APIs cannot guarantee the native iPhone Camera application's macro-mode or physical-lens switching. The web delivery therefore targets the best supported browser behavior and uses real-device measurements to decide whether native work is justified.

## 3. Objective

An operator taps **Scan parts** and receives:

1. Immediate rear-camera startup.
2. Best available automatic focus.
3. Fast QR recognition.
4. Clear recovery when camera access fails.
5. Manual-entry escape hatch within one action.
6. Exact-unit result in the existing draggable drawer.
7. Reliable **Scan another** continuation.

## 4. Scope

### Included

- Camera lifecycle and stale-session protection.
- Camera error classification.
- Best-effort rear-camera, focus, focus-point, zoom, and torch behavior.
- QR-only detector optimization.
- Starting, active, resolving, invalid, permission-denied, unavailable, busy, unsupported, failure, and manual-entry states.
- Shared scanner styling.
- Accessibility, safe-area, zoom, reflow, and reduced-motion behavior.
- Existing scanner-consumer consolidation where it removes duplicate camera ownership.
- Automated, rendered-browser, and physical-device verification.
- Explicit native escalation criteria.

### Excluded

- Backend inventory-model changes.
- Role or permission-policy changes.
- Serialized-unit lifecycle changes.
- Native mobile application.
- PWA installation work.
- Capacitor shell.
- Mobile authentication.
- Offline inventory confirmation or mutation.
- App Store or Play Store distribution.
- Zebra/DataWedge integration.
- Staging deployment without separate authorization.

## 5. Target Operator Flow

### 5.1 Open scanner

Operator taps **Scan parts**.

The scanner:

- Opens full-screen.
- Requests the rear camera automatically.
- Shows the camera feed edge-to-edge.
- Shows one restrained, functional QR target.
- Keeps Close at the top-right.
- Keeps **Enter code manually** at the bottom.
- Shows a flashlight control only when the active camera reports torch support.

### 5.2 Camera starting

Visible state: **Starting camera…**

Requirements:

- Stable geometry with no empty flash.
- Close remains usable.
- Manual entry remains available.
- Screen reader receives one status update.
- A second camera request cannot start while the first is pending.

### 5.3 Active scanning

The scanner:

- Requests an ideal, not required, rear-camera resolution.
- Applies continuous autofocus when supported.
- Applies a center focus point when supported.
- Tests capability-bounded zoom during physical verification.
- Ships an automatic zoom preset only when device evidence shows improvement.
- Processes one frame at a time.
- Scans the visual target region first.
- Periodically scans the full frame.
- Blocks duplicate candidates while server resolution is in flight.

The UI must never claim that native macro mode is active.

### 5.4 QR detected

The scanner:

- Stops further frame processing.
- Shows **Opening part…**.
- Sends the raw value to the existing authenticated server resolver.
- Treats decoded text as untrusted input.
- Shows no exact-unit data before server authorization succeeds.

### 5.5 Valid result

The existing draggable result drawer opens with:

- Part number.
- Description.
- Serial number.
- Location.
- Eligibility or status.
- Pending-scan count.
- Valid workorder action.
- **Scan another**.

Existing server authorization, idempotency, issue/reserve behavior, and exact-unit scope remain unchanged.

### 5.6 Scan another

- Drawer moves to peek.
- Camera restarts only after actual transform settlement.
- If the final action removes the drawer, the camera restarts directly because no settlement callback can occur.
- Stale callbacks and stale streams cannot restart an old session.

### 5.7 Invalid QR or unavailable unit

The scanner does not return to a dead background.

Show a compact error surface containing:

- Plain reason.
- **Scan again**.
- **Enter code manually**.
- Close.

Camera restart requires explicit **Scan again** so the same invalid label cannot trigger an automatic loop.

### 5.8 Camera failure

| Failure | Operator message | Primary action |
|---|---|---|
| Permission denied | Camera permission is blocked | Review permission and retry |
| No camera | No usable camera was found | Enter code manually |
| Camera busy | Another app may be using the camera | Try again |
| Unsupported browser or context | Camera scanning is unavailable here | Enter code manually |
| Constraint failure | Requested camera mode is unavailable | Retry with relaxed settings |
| Unknown failure | Camera could not start | Try again |

Every state keeps safe navigation and manual entry available.

### 5.9 Manual entry

Manual mode:

- Stops the camera and releases all tracks.
- Shows a compact, keyboard-safe surface.
- Focuses the input.
- Preserves the entered value after a server error.
- Uses **Open part** as the primary action.
- Uses **Try camera again** as the secondary action.
- Keeps Close visible.

## 6. UI Contract

### 6.1 Active camera

- Live video is the main surface.
- Dark scrims appear only behind controls where contrast is required.
- One functional QR target guides placement.
- No large title or decorative card.
- No permanent technical status paragraph.
- No opaque full-screen navy layer over a working camera.
- Frequent phone controls meet the 44px target.
- All fixed controls respect safe-area insets.

### 6.2 Failure state

- Application neutral canvas.
- Camera or QR indicator.
- Short failure heading.
- One-sentence cause.
- One primary recovery action.
- Manual-entry action.
- No enormous empty region.
- No disabled action before the explanation.

### 6.3 Manual state

- Bounded surface.
- Visible input label.
- Full-width input.
- Full-width primary action on phone.
- Software keyboard cannot obscure the input or action.
- Error remains inside the visible workflow.

### 6.4 Result state

Retain the existing bottom drawer. Do not add a separate result page or nested scanner modal.

## 7. State Model

Replace combinations of camera booleans with one explicit scanner state:

```text
idle
starting
scanning
resolving
invalid
permission-denied
no-camera
camera-busy
unsupported
failed
manual
```

State transitions must remain deterministic and testable. Reset, close, unmount, and stale-session transitions must release camera resources.

## 8. Technical Ownership

### 8.1 `frontend/src/features/inventory/inventory-camera-scanner.js`

Add:

- Ideal camera-request profile.
- Relaxed fallback constraints.
- Camera-error classifier.
- Capability inspection.
- Continuous-focus configuration.
- Center focus-point configuration.
- Torch capability and control hook.
- Evidence-gated zoom configuration.
- Region-of-interest QR detection.
- Non-overlapping frame scheduler.

Preserve:

- Native `BarcodeDetector` preference.
- jsQR fallback.
- Missing or rejected capabilities failing open.

### 8.2 `frontend/src/features/inventory/InventoryCodeScanner.jsx`

Own:

- Explicit scanner state.
- Retry behavior.
- Scan-again behavior.
- Manual-entry behavior.
- Focus management.
- Background/visibility cleanup.
- Accessible state announcements.
- Optional torch control.

Preserve:

- Reset keys.
- Generation guards.
- In-flight guards.
- Track cleanup.
- Existing `onScan` contract.

### 8.3 `frontend/src/features/inventory/inventory-code-scanner.css`

Create this shared stylesheet to own:

- Full-screen scanner shell.
- Camera stage.
- QR target.
- Camera controls.
- Recovery surface.
- Manual-entry surface.
- Safe-area behavior.
- Responsive behavior.
- Reduced motion.
- Forced-color behavior.

### 8.4 `frontend/src/components/workorders/part-requests/mechanic-serialized-parts.css`

Retain only:

- Mechanic scanner trigger.
- Full-screen modal host.
- Result drawer layout.
- Serialized-part result and actions.
- Mechanic-specific responsive rules.

Remove shared scanner-presentation rules after the new inventory-owned stylesheet is active.

### 8.5 `frontend/src/features/inventory/InventoryScanWorkspace.jsx`

Use the shared scanner rather than maintaining a separate camera session and detection loop.

The dedicated Inventory page continues to own:

- Exact-unit result page.
- Receipt and event history.
- Back-to-workspace action.

### 8.6 Other consumers

Verify behavior in:

- `SerializedPartsScanner.jsx`.
- `CreatePartScanner.jsx`.
- `WorkorderSerializedPartDialog.jsx`.

No consumer should implement an independent camera lifecycle.

## 9. Camera Configuration

### 9.1 Initial request

Use ideal constraints so unsupported preferences do not block access:

- Environment-facing camera.
- High-enough ideal resolution for production QR labels.
- Bounded frame rate suitable for recognition and battery use.

If constraints fail, retry once with relaxed rear-camera constraints before entering an error state.

### 9.2 Track capabilities

After obtaining a current stream:

1. Select the first live video track.
2. Read capabilities and current settings.
3. Apply continuous focus when listed.
4. Apply the center focus point when recognized.
5. Expose torch only when supported.
6. Apply no arbitrary focus distance.
7. Apply no arbitrary zoom value before physical evidence.
8. Re-read settings where available to record whether the request took effect.

All awaited operations must validate the current camera session before and after completion.

## 10. Detection Design

1. Wait for video metadata and successful playback.
2. Prefer `requestVideoFrameCallback` when available.
3. Use a throttled fallback scheduler otherwise.
4. Prevent overlapping detection promises.
5. Request QR recognition only for this workflow.
6. Crop the center target for the first jsQR attempt.
7. Run a periodic full-frame fallback.
8. Stop the scheduler immediately after candidate detection.
9. Ignore stale results after reset, close, manual entry, or unmount.
10. Preserve server-side normalization and authorization.

## 11. Camera Lifecycle Rules

Camera stops when:

- Scanner closes.
- Manual mode opens.
- A candidate begins server resolution.
- Component unmounts.
- Reset key changes.
- Page becomes hidden.
- Session becomes stale.

Camera restarts when:

- Operator selects Retry.
- Operator selects Scan again.
- Result drawer physically settles at peek.
- Result drawer disappears after the final action.

Only one live stream and one detector request may exist at a time.

## 12. Accessibility

- Close, torch, Retry, manual entry, and submit controls use 44px phone targets.
- Input has a visible label.
- Focus order follows visual order.
- Failure moves focus to the recovery heading.
- Manual selection moves focus to the input.
- Closing restores focus to the scanner trigger.
- Failures use `role="alert"`.
- Starting and resolving use restrained `role="status"` announcements.
- QR target is decorative to assistive technology.
- Frame processing produces no screen-reader announcements.
- Reduced motion removes nonessential target animation.
- 200% zoom preserves meaning and operability.
- 320px reflow has no horizontal scrolling.
- Forced colors preserve control boundaries and focus indicators.

## 13. Implementation Sequence

### Slice 1 — State and error model

- Add explicit scanner states.
- Classify camera errors.
- Add relaxed constraint retry.
- Add focused unit tests.

**Gate:** Every startup outcome maps to one deterministic state and recovery action.

### Slice 2 — Camera tuning

- Add ideal rear-camera request.
- Add capability inspection.
- Apply supported continuous focus.
- Apply supported center focus point.
- Expose torch capability.
- Add zoom experiment through one bounded helper.

**Gate:** Missing or rejected capability never blocks scanning.

### Slice 3 — Detection engine

- Add frame callback scheduler.
- Add in-flight detector lock.
- Add center-region detection.
- Add periodic full-frame fallback.
- Preserve native and jsQR paths.

**Gate:** No overlapping detector work and no stale candidate delivery.

### Slice 4 — UI rebuild

- Add active-camera composition.
- Add QR target.
- Add recovery surface.
- Add manual-entry surface.
- Add invalid-scan surface.
- Extract shared CSS.

**Gate:** No scanner state shows a dead solid viewport.

### Slice 5 — Consumer consolidation

- Route dedicated Inventory scanning through the shared owner.
- Verify Create and workorder consumers.
- Preserve drawer and focus-return contracts.

**Gate:** One camera implementation serves every scanner surface.

### Slice 6 — Verification and bounded fixes

- Run focused tests.
- Run repository checks.
- Render state and viewport matrix.
- Run physical-device benchmark.
- Perform independent skeptical review.
- Apply bounded fixes only.

## 14. Automated Verification

Focused checks:

```bash
node --test \
  frontend/src/features/inventory/inventory-camera-scanner.test.js \
  frontend/src/features/inventory/inventory-code-scanner.lifecycle.test.js \
  frontend/src/features/inventory/inventory-scan.contract.test.js \
  frontend/src/components/workorders/part-requests/mechanic-serialized-parts.contract.test.js
```

Broader checks:

```bash
npm run test:unit
npm run check
npm run verify
git diff --check
```

`npm run test:role-workflow` is separate authenticated workflow evidence. Do not report it as passed unless required roles, credentials, and environment are actually available.

## 15. Rendered Browser Matrix

Test:

- 320px.
- 390px.
- 430px.
- 768px.
- 1440px.
- 200% zoom.
- Reduced motion.
- Forced colors where available.
- Software keyboard open.
- Permission denied.
- No camera.
- Camera busy.
- Manual entry.
- Invalid QR.
- Successful QR.
- Result drawer expanded.
- Result drawer peek.
- Scan another.
- Close and focus restoration.

Fake camera proves UI and lifecycle only. It does not prove physical autofocus, lens choice, zoom actuation, or QR performance.

## 16. Physical-Device Benchmark

### Devices

- Current target iPhone.
- One representative Android phone.

### Samples

- Smallest production label.
- Standard production label.
- Glossy label.
- Dirty or damaged label.
- Low-light label.
- Angled label.

### Runs

- 50 standard-label scans per device.
- 20 scans for each stress condition.
- Cold camera startup.
- Repeated **Scan another**.
- Permission denial and recovery.
- Page background and resume.
- Camera already used by another application.

### Measurements

- Start-to-preview time.
- Stable-frame-to-decode time.
- Success or failure.
- Manual-entry use.
- Camera restart failure.
- Device and browser version.
- Reported focus, zoom, and torch capability.
- Battery or thermal problem.

Benchmark logs must never contain raw QR payloads.

## 17. Definition of Done

The delivery passes when:

- At least 49 of 50 standard-label scans succeed on each target phone.
- Median stable-frame-to-decode time is 1.5 seconds or less.
- p95 stable-frame-to-decode time is 3 seconds or less.
- Ordinary scans require no manual zoom.
- No state shows a dead solid viewport.
- Every camera failure exposes cause and recovery.
- Manual entry is reachable within one action.
- Camera tracks always stop correctly.
- Invalid QR cannot create an automatic rescan loop.
- Exact-unit server authorization remains unchanged.
- Result-drawer restart timing remains correct.
- Required automated checks pass.
- Physical-device evidence is reported separately from browser evidence.
- Task-owned changes remain isolated from the existing dirty worktree.

## 18. Native Escalation Rule

Stop after web delivery when physical gates pass.

Create an iOS native scanner proof of concept only when one or more conditions remain after bounded web fixes:

- iPhone repeatedly selects an unsuitable lens.
- Close-focus failure remains.
- Standard-label success stays below 49 of 50.
- p95 decode time stays above 3 seconds.

Native proof-of-concept scope:

- QR scanning only.
- VisionKit or AVFoundation only.
- Production-label benchmark.
- No mobile authentication.
- No inventory mutation.
- No App Store release.
- No Android application.

Hybrid app planning begins only when the native proof of concept materially outperforms the optimized web scanner.

## 19. Expected End Result

Mechanic taps **Scan parts**. The camera opens immediately with a clean live preview and restrained QR target. The scanner uses the best browser-supported rear-camera focus behavior and resolves the label quickly. A valid exact unit opens in the existing draggable drawer. The mechanic performs the allowed action, minimizes the drawer, and continues scanning without reopening the workflow.

Permission or camera failure produces a compact, specific recovery surface instead of a blank navy screen. Manual entry remains obvious and keyboard-safe. Unsupported focus, zoom, or torch capabilities degrade safely. Inventory authority, exact-unit validation, permissions, idempotency, and workorder lifecycle remain server-owned.

Final product outcome: a production-quality web scanner plus physical evidence deciding whether native camera investment is necessary.

## 20. References

- [W3C Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)
- [W3C MediaStream Image Capture](https://www.w3.org/TR/image-capture/)
- `frontend/src/features/inventory/InventoryCodeScanner.jsx`
- `frontend/src/features/inventory/inventory-camera-scanner.js`
- `frontend/src/features/inventory/inventory-camera-session.js`
- `frontend/src/features/inventory/InventoryScanWorkspace.jsx`
- `frontend/src/components/workorders/part-requests/SerializedPartsScanner.jsx`
- `frontend/src/components/workorders/part-requests/mechanic-serialized-parts.css`
