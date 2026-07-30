import { useState } from "react";
import { ArrowLeft, LogIn01, RefreshCw01, User01 } from "@untitledui/icons";
import { api } from "../../lib/api.js";
import { textEntryProps } from "../../components/forms/text-entry-policy.js";
import {
  isCompleteKioskPin,
  kioskPinValue,
  kioskUnlockError,
} from "./kiosk-utils.js";
import "./kiosk.css";

function KioskMechanicButton({ mechanic, onSelect }) {
  return (
    <button
      className="kiosk-mechanic"
      type="button"
      onClick={() => onSelect(mechanic)}
      aria-label={`Unlock as ${mechanic.name}`}
    >
      <span className="kiosk-mechanic-initials" aria-hidden="true">{mechanic.initials}</span>
      <span>
        <strong>{mechanic.name}</strong>
        <small>Mechanic</small>
      </span>
    </button>
  );
}

export function KioskGate({ context, onRefresh, onStandardLogin }) {
  const [mechanic, setMechanic] = useState(null);
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function selectMechanic(nextMechanic) {
    setMechanic(nextMechanic);
    setPin("");
    setNewPin("");
    setConfirmPin("");
    setError("");
  }

  async function unlock(event) {
    event.preventDefault();
    if (!mechanic || !isCompleteKioskPin(pin)) return;
    if (mechanic.requiresPinChange && (!isCompleteKioskPin(newPin) || newPin !== confirmPin)) return;

    setSubmitting(true);
    setError("");
    try {
      await api("/api/auth/kiosk/unlock", {
        method: "POST",
        body: JSON.stringify({
          mechanicId: mechanic.id,
          pin,
          ...(mechanic.requiresPinChange ? { newPin } : {}),
        }),
      });
      window.location.replace("/");
    } catch (unlockError) {
      setError(kioskUnlockError(unlockError.status));
      setSubmitting(false);
    }
  }

  if (mechanic) {
    const pinChangeInvalid = mechanic.requiresPinChange
      && (!isCompleteKioskPin(newPin) || newPin !== confirmPin);
    return (
      <main className="kiosk-shell">
        <section className="kiosk-panel kiosk-unlock-panel" aria-labelledby="kiosk-unlock-title">
          <button className="kiosk-back" type="button" onClick={() => selectMechanic(null)}>
            <ArrowLeft />
            <span>All mechanics</span>
          </button>
          <div className="kiosk-selected-mechanic">
            <span className="kiosk-mechanic-initials" aria-hidden="true">{mechanic.initials}</span>
            <div>
              <p>{context.device.locationName}</p>
              <h1 id="kiosk-unlock-title">{mechanic.name}</h1>
            </div>
          </div>
          <form className="kiosk-pin-form" onSubmit={unlock}>
            <label htmlFor="kiosk-pin">
              <span>{mechanic.requiresPinChange ? "Temporary PIN" : "PIN"}</span>
              <input
                {...textEntryProps("identifier")}
                id="kiosk-pin"
                autoComplete="one-time-code"
                inputMode="numeric"
                minLength="4"
                pattern="[0-9]{4,}"
                type="text"
                value={pin}
                onChange={(event) => {
                  setPin(kioskPinValue(event.target.value));
                  setError("");
                }}
                aria-describedby={error ? "kiosk-unlock-error" : undefined}
                required
              />
            </label>
            {mechanic.requiresPinChange ? (
              <div className="kiosk-pin-change">
                <p>Choose a new private PIN with at least four digits before continuing.</p>
                <label htmlFor="kiosk-new-pin">
                  <span>New PIN</span>
                  <input
                    {...textEntryProps("identifier")}
                    id="kiosk-new-pin"
                    autoComplete="new-password"
                    inputMode="numeric"
                    minLength="4"
                    pattern="[0-9]{4,}"
                    type="text"
                    value={newPin}
                    onChange={(event) => {
                      setNewPin(kioskPinValue(event.target.value));
                      setError("");
                    }}
                    required
                  />
                </label>
                <label htmlFor="kiosk-confirm-pin">
                  <span>Confirm new PIN</span>
                  <input
                    {...textEntryProps("identifier")}
                    id="kiosk-confirm-pin"
                    autoComplete="new-password"
                    inputMode="numeric"
                    minLength="4"
                    pattern="[0-9]{4,}"
                    type="text"
                    value={confirmPin}
                    onChange={(event) => {
                      setConfirmPin(kioskPinValue(event.target.value));
                      setError("");
                    }}
                    required
                  />
                </label>
              </div>
            ) : null}
            {error ? <p className="kiosk-error" id="kiosk-unlock-error" role="alert">{error}</p> : null}
            <button
              className="kiosk-primary-action"
              type="submit"
              disabled={submitting || !isCompleteKioskPin(pin) || pinChangeInvalid}
            >
              {submitting ? "Unlocking..." : "Unlock workorders"}
            </button>
          </form>
          <button className="kiosk-standard-login" type="button" onClick={onStandardLogin}>
            <LogIn01 />
            <span>Use standard login</span>
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="kiosk-shell">
      <section className="kiosk-panel" aria-labelledby="kiosk-title">
        <header className="kiosk-heading">
          <span className="kiosk-heading-icon" aria-hidden="true"><User01 /></span>
          <div>
            <p>{context.device.locationName}</p>
            <h1 id="kiosk-title">Choose your name</h1>
          </div>
        </header>
        {context.mechanics.length ? (
          <div className="kiosk-roster" aria-label="Mechanics">
            {context.mechanics.map((entry) => (
              <KioskMechanicButton key={entry.id} mechanic={entry} onSelect={selectMechanic} />
            ))}
          </div>
        ) : (
          <div className="kiosk-empty" role="status">
            <strong>No mechanics available</strong>
            <p>Ask an administrator to check this kiosk location.</p>
          </div>
        )}
        <div className="kiosk-footer-actions">
          <button type="button" onClick={onRefresh}>
            <RefreshCw01 />
            <span>Refresh</span>
          </button>
          <button type="button" onClick={onStandardLogin}>
            <LogIn01 />
            <span>Standard login</span>
          </button>
        </div>
      </section>
    </main>
  );
}

export function KioskStandardLogin({ onReturnToKiosk }) {
  return (
    <button className="kiosk-return-button" type="button" onClick={onReturnToKiosk}>
      <User01 />
      <span>Return to kiosk</span>
    </button>
  );
}
