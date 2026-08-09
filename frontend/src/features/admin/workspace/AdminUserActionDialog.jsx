import { Lock01, Mail01, Passcode, Trash01, UserCheck01, UserX01 } from "@untitledui/icons";
import { textEntryProps } from "../../../components/forms/text-entry-policy.js";
import { PasswordVisibilityToggle } from "../../../components/ui/PasswordVisibilityToggle.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { isCompleteKioskPin, kioskPinValue } from "../../kiosk/kiosk-utils.js";
import { LocationSelector, Modal } from "./AdminLocationDialogs.jsx";

function dialogTitle(userAction) {
  if (userAction.type === "locations") return "Location access";
  if (userAction.type === "password") return "Set mechanic password";
  if (userAction.type === "password-reset-email") return "Send password reset";
  if (userAction.type === "kiosk-pin") return `${userAction.user.kiosk_pin_set ? "Reset" : "Set"} kiosk PIN`;
  if (userAction.type === "modules") return "Module access";
  if (userAction.type === "delete") return "Delete user";
  return `${userAction.type === "activate" ? "Activate" : "Deactivate"} user`;
}

export function AdminUserActionDialog({
  userAction,
  onClose,
  onSubmit,
  busy,
  error,
  companyLocations,
  userLocationDraft,
  setUserLocationDraft,
  passwordDraft,
  setPasswordDraft,
  visiblePasswords,
  setVisiblePasswords,
  kioskPinDraft,
  setKioskPinDraft,
  kioskPinError,
  setKioskPinError,
  clearError,
}) {
  if (!userAction) return null;
  return (
    <Modal title={dialogTitle(userAction)} onClose={() => !busy && onClose()}>
      <form className="admin-modal-form" onSubmit={onSubmit}>
        {error ? <p className="admin-modal-error" role="alert">{error}</p> : null}
        {userAction.type === "locations" ? (
          userAction.user.role === "admin" ? (
            <div className="admin-inherited-access">
              <strong>All locations</strong>
              <p>Admins automatically inherit access to every current and future location.</p>
              <Button type="button" onClick={onClose}>Done</Button>
            </div>
          ) : (
            <>
              <p className="admin-modal-copy">Choose the locations <strong>{userAction.user.name}</strong> can access. Their company role remains unchanged.</p>
              <LocationSelector locations={companyLocations} value={userLocationDraft} onChange={setUserLocationDraft} />
              <Button variant="primary" type="submit" disabled={busy || !userLocationDraft.length}>{busy ? "Saving" : "Save location access"}</Button>
            </>
          )
        ) : userAction.type === "password" ? (
          <>
            <p className="admin-modal-copy">Set a new password for <strong>{userAction.user.name}</strong>. No email is required. Their current sessions will be signed out.</p>
            <div className="password-field-group admin-password-field-group">
              <label htmlFor="admin-new-password"><span>New password</span></label>
              <div className="password-input-control">
                <input {...textEntryProps("identifier")} id="admin-new-password" required autoFocus type={visiblePasswords.password ? "text" : "password"} minLength="12" maxLength="128" autoComplete="new-password" aria-invalid={passwordDraft.password.length > 0 && passwordDraft.password.length < 12} value={passwordDraft.password} onChange={(event) => { setPasswordDraft((current) => ({ ...current, password: event.target.value })); clearError(); }} />
                <PasswordVisibilityToggle visible={visiblePasswords.password} controls="admin-new-password" onToggle={() => setVisiblePasswords((current) => ({ ...current, password: !current.password }))} />
              </div>
            </div>
            <div className="password-field-group admin-password-field-group">
              <label htmlFor="admin-confirm-password"><span>Confirm password</span></label>
              <div className="password-input-control">
                <input {...textEntryProps("identifier")} id="admin-confirm-password" required type={visiblePasswords.confirmation ? "text" : "password"} minLength="12" maxLength="128" autoComplete="new-password" aria-invalid={passwordDraft.confirmation.length > 0 && passwordDraft.password !== passwordDraft.confirmation} value={passwordDraft.confirmation} onChange={(event) => { setPasswordDraft((current) => ({ ...current, confirmation: event.target.value })); clearError(); }} />
                <PasswordVisibilityToggle visible={visiblePasswords.confirmation} controls="admin-confirm-password" onToggle={() => setVisiblePasswords((current) => ({ ...current, confirmation: !current.confirmation }))} />
              </div>
            </div>
            <div className="admin-password-rules" aria-live="polite">
              <span className={passwordDraft.password.length >= 12 ? "valid" : ""}>At least 12 characters</span>
              <span className={passwordDraft.confirmation && passwordDraft.password === passwordDraft.confirmation ? "valid" : passwordDraft.confirmation ? "invalid" : ""}>Passwords match</span>
            </div>
            <Button variant="primary" icon={Lock01} type="submit" disabled={busy || passwordDraft.password.length < 12 || passwordDraft.password !== passwordDraft.confirmation}>{busy ? "Setting" : "Set password"}</Button>
          </>
        ) : userAction.type === "password-reset-email" ? (
          <>
            <p className="admin-modal-copy">Send a secure, one-use password reset link to <strong>{userAction.user.login_email || userAction.user.email}</strong>. The link expires after 15 minutes.</p>
            <Button variant="primary" icon={Mail01} type="submit" disabled={busy}>{busy ? "Sending" : "Send reset email"}</Button>
          </>
        ) : userAction.type === "kiosk-pin" ? (
          <>
            <p className="admin-modal-copy">Set a temporary kiosk PIN for <strong>{userAction.user.name}</strong>. They must replace it after their first kiosk unlock.</p>
            <label htmlFor="admin-kiosk-pin">
              <span>Temporary PIN</span>
              <input {...textEntryProps("identifier")} id="admin-kiosk-pin" autoFocus autoComplete="new-password" inputMode="numeric" minLength="4" pattern="[0-9]{4,}" type="password" aria-describedby={kioskPinError ? "admin-kiosk-pin-error" : undefined} aria-invalid={Boolean(kioskPinError)} value={kioskPinDraft.pin} onChange={(event) => { setKioskPinDraft((current) => ({ ...current, pin: kioskPinValue(event.target.value) })); setKioskPinError(""); }} required />
            </label>
            <label htmlFor="admin-kiosk-pin-confirmation">
              <span>Confirm PIN</span>
              <input {...textEntryProps("identifier")} id="admin-kiosk-pin-confirmation" autoComplete="new-password" inputMode="numeric" minLength="4" pattern="[0-9]{4,}" type="password" value={kioskPinDraft.confirmation} onChange={(event) => { setKioskPinDraft((current) => ({ ...current, confirmation: kioskPinValue(event.target.value) })); setKioskPinError(""); }} required />
            </label>
            {kioskPinError ? <small className="admin-kiosk-pin-error" id="admin-kiosk-pin-error" role="alert">{kioskPinError}</small> : null}
            <Button variant="primary" icon={Passcode} type="submit" disabled={busy || !isCompleteKioskPin(kioskPinDraft.pin) || kioskPinDraft.pin !== kioskPinDraft.confirmation}>{busy ? "Saving" : `${userAction.user.kiosk_pin_set ? "Reset" : "Set"} temporary PIN`}</Button>
          </>
        ) : userAction.type === "delete" ? (
          <>
            <p className="admin-modal-copy">Delete <strong>{userAction.user.name}</strong>? Their login will be removed and their historical work records will remain under “Deleted user.” This cannot be undone.</p>
            <Button variant="danger" icon={Trash01} type="submit" disabled={busy}>{busy ? "Deleting" : "Delete user"}</Button>
          </>
        ) : (
          <>
            <p className="admin-modal-copy">{userAction.type === "activate" ? "Restore login and location access" : "Sign out and block access"} for <strong>{userAction.user.name}</strong>?</p>
            <Button variant={userAction.type === "activate" ? "primary" : "danger"} icon={userAction.type === "activate" ? UserCheck01 : UserX01} type="submit" disabled={busy}>{busy ? "Saving" : userAction.type === "activate" ? "Activate user" : "Deactivate user"}</Button>
          </>
        )}
      </form>
    </Modal>
  );
}
