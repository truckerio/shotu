import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, LogIn01, RefreshCw01, User01 } from "@untitledui/icons";
import { api } from "../../lib/api.js";
import { textEntryProps } from "../../components/forms/text-entry-policy.js";
import { interfaceText, normalizeLocale } from "../../i18n/index.js";
import {
  isCompleteKioskPin,
  kioskMechanicIdentity,
  kioskMechanicsInDisplayOrder,
  kioskPinValue,
  kioskStoredLocale,
  kioskUnlockError,
  saveKioskLocale,
} from "./kiosk-utils.js";
import "./kiosk.css";

const KIOSK_LANGUAGE_OPTIONS = Object.freeze([
  { value: "en", label: "English" },
  { value: "pa", label: "ਪੰਜਾਬੀ" },
  { value: "es", label: "Español" },
]);

function KioskMechanicButton({ locale, mechanic, onSelect }) {
  const identity = kioskMechanicIdentity(mechanic);
  const text = (key) => interfaceText(locale, key);

  return (
    <button
      className="kiosk-mechanic"
      type="button"
      onClick={() => onSelect(mechanic)}
      aria-label={`${text("kiosk.unlockAs")} ${mechanic.name}`}
    >
      <span className={`kiosk-mechanic-initials ${identity.tone}`} aria-hidden="true">
        {identity.marker}
      </span>
      <span className="kiosk-mechanic-name">
        <strong>{mechanic.name}</strong>
        <small>{text("kiosk.mechanic")}</small>
      </span>
    </button>
  );
}

export function KioskGate({ context, onRefresh, onStandardLogin, onReturnToRoster, onUnlockStart, onUnlockError, onUnlocked, unlocking, handoffError = "" }) {
  const [mechanic, setMechanic] = useState(null);
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [deviceLocale, setDeviceLocale] = useState(kioskStoredLocale);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const unlockController = useRef(null);
  const activeLocale = normalizeLocale(mechanic?.locale || deviceLocale);
  const text = (key) => interfaceText(activeLocale, key);
  const visibleError = error || (handoffError ? text("kiosk.error.tryLater") : "");

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; unlockController.current?.abort(); };
  }, []);

  useEffect(() => {
    if (unlocking === false) {
      unlockController.current?.abort();
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }, [unlocking]);

  function changeDeviceLocale(event) {
    setDeviceLocale(saveKioskLocale(event.target.value));
  }

  function selectMechanic(nextMechanic) {
    if (inFlightRef.current) return;
    setMechanic(nextMechanic);
    setPin("");
    setNewPin("");
    setConfirmPin("");
    setError("");
  }

  async function unlock(event) {
    event.preventDefault();
    if (inFlightRef.current || !mechanic || !isCompleteKioskPin(pin)) return;
    if (mechanic.requiresPinChange && (!isCompleteKioskPin(newPin) || newPin !== confirmPin)) return;

    inFlightRef.current = true;
    unlockController.current = new AbortController();
    let accepted = false;
    setSubmitting(true);
    setError("");
    onUnlockStart?.();
    try {
      await api("/api/auth/kiosk/unlock", {
        method: "POST",
        signal: unlockController.current.signal,
        body: JSON.stringify({
          mechanicId: mechanic.id,
          pin,
          ...(mechanic.requiresPinChange ? { newPin } : {}),
        }),
      });
      if (!mountedRef.current) return;
      accepted = true;
      setPin("");
      setNewPin("");
      setConfirmPin("");
      document.activeElement?.blur();
      window.history.replaceState(window.history.state, "", "/");
      await onUnlocked?.(unlockController.current.signal);
    } catch (unlockError) {
      if (!mountedRef.current) return;
      if (accepted) setMechanic((current) => ({ ...current, requiresPinChange: false }));
      setError(accepted ? text("kiosk.error.tryLater") : kioskUnlockError(unlockError.status, activeLocale));
      setSubmitting(false);
      inFlightRef.current = false;
      onUnlockError?.();
    }
  }

  if (mechanic) {
    const identity = kioskMechanicIdentity(mechanic);
    const pinChangeInvalid = mechanic.requiresPinChange
      && (!isCompleteKioskPin(newPin) || newPin !== confirmPin);
    return (
      <main className="kiosk-shell">
        <section className="kiosk-panel kiosk-unlock-panel" aria-labelledby="kiosk-unlock-title">
          <button className="kiosk-back" type="button" disabled={submitting} onClick={() => { selectMechanic(null); onReturnToRoster?.(); }}>
            <ArrowLeft />
            <span>{text("kiosk.allMechanics")}</span>
          </button>
          <div className="kiosk-selected-mechanic">
            <span className={`kiosk-mechanic-initials ${identity.tone}`} aria-hidden="true">
              {identity.marker}
            </span>
            <div>
              <p>{context.device.locationName}</p>
              <h1 id="kiosk-unlock-title">{mechanic.name}</h1>
            </div>
          </div>
          <form className="kiosk-pin-form" onSubmit={unlock}>
            <label htmlFor="kiosk-pin">
              <span>{text(mechanic.requiresPinChange ? "kiosk.temporaryPin" : "kiosk.pin")}</span>
              <input
                {...textEntryProps("identifier")}
                id="kiosk-pin"
                autoFocus
                autoComplete="one-time-code"
                disabled={submitting}
                inputMode="numeric"
                minLength="4"
                pattern="[0-9]{4,}"
                type="text"
                value={pin}
                onChange={(event) => {
                  setPin(kioskPinValue(event.target.value));
                  setError("");
                }}
                aria-describedby={visibleError ? "kiosk-unlock-error" : undefined}
                required
              />
            </label>
            {mechanic.requiresPinChange ? (
              <div className="kiosk-pin-change">
                <p>{text("kiosk.choosePrivatePin")}</p>
                <label htmlFor="kiosk-new-pin">
                  <span>{text("kiosk.newPin")}</span>
                  <input
                    {...textEntryProps("identifier")}
                    id="kiosk-new-pin"
                    autoComplete="new-password"
                    disabled={submitting}
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
                  <span>{text("kiosk.confirmNewPin")}</span>
                  <input
                    {...textEntryProps("identifier")}
                    id="kiosk-confirm-pin"
                    autoComplete="new-password"
                    disabled={submitting}
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
            {visibleError ? <p className="kiosk-error" id="kiosk-unlock-error" role="alert">{visibleError}</p> : null}
            <button
              className="kiosk-primary-action"
              type="submit"
              disabled={submitting || !isCompleteKioskPin(pin) || pinChangeInvalid}
            >
              {text(submitting ? "kiosk.unlocking" : "kiosk.unlockWorkorders")}
            </button>
          </form>
          <button className="kiosk-standard-login" type="button" disabled={submitting} onClick={onStandardLogin}>
            <LogIn01 />
            <span>{text("kiosk.useStandardLogin")}</span>
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="kiosk-shell">
      <section className="kiosk-panel" aria-labelledby="kiosk-title">
        <div className="kiosk-topline">
          <header className="kiosk-heading">
            <span className="kiosk-heading-icon" aria-hidden="true"><User01 /></span>
            <div>
              <p>{context.device.locationName}</p>
              <h1 id="kiosk-title">{text("kiosk.chooseName")}</h1>
            </div>
          </header>
          <label className="kiosk-language" htmlFor="kiosk-language">
            <span>{text("kiosk.language")}</span>
            <Dropdown id="kiosk-language" value={deviceLocale} onChange={changeDeviceLocale}>
              {KIOSK_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Dropdown>
          </label>
        </div>
        {context.mechanics.length ? (
          <div className="kiosk-roster" aria-label={text("kiosk.mechanics")}>
            {kioskMechanicsInDisplayOrder(context.mechanics).map((entry) => (
              <KioskMechanicButton
                key={entry.id}
                locale={deviceLocale}
                mechanic={entry}
                onSelect={selectMechanic}
              />
            ))}
          </div>
        ) : (
          <div className="kiosk-empty" role="status">
            <strong>{text("kiosk.noMechanics")}</strong>
            <p>{text("kiosk.askAdministrator")}</p>
          </div>
        )}
        <div className="kiosk-footer-actions">
          <button type="button" onClick={onRefresh}>
            <RefreshCw01 />
            <span>{text("kiosk.refresh")}</span>
          </button>
          <button type="button" onClick={onStandardLogin}>
            <LogIn01 />
            <span>{text("kiosk.standardLogin")}</span>
          </button>
        </div>
      </section>
    </main>
  );
}

export function KioskStandardLogin({ onReturnToKiosk }) {
  const locale = kioskStoredLocale();
  return (
    <button className="kiosk-return-button" type="button" onClick={onReturnToKiosk}>
      <User01 />
      <span>{interfaceText(locale, "kiosk.return")}</span>
    </button>
  );
}
