import { useEffect, useMemo, useState } from "react";
import { Key01, Monitor01, RefreshCw01, Trash01 } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";
import {
  isCompleteKioskPin,
  kioskPinValue,
} from "../kiosk/kiosk-utils.js";
import { kioskPinFieldError } from "./kiosk-admin-errors.js";
import "./kiosk-settings.css";

const DEFAULT_TEMPORARY_KIOSK_PIN = "0000";

function formatDeviceDate(value) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function KioskSettingsPanel({ locationId, users = [] }) {
  const [devices, setDevices] = useState([]);
  const [deviceName, setDeviceName] = useState("");
  const [selectedMechanicId, setSelectedMechanicId] = useState("");
  const [pin, setPin] = useState(DEFAULT_TEMPORARY_KIOSK_PIN);
  const [pinError, setPinError] = useState("");
  const [confirmation, setConfirmation] = useState(DEFAULT_TEMPORARY_KIOSK_PIN);
  const [state, setState] = useState({
    busy: "",
    error: "",
    loading: true,
    message: "",
  });

  const mechanics = useMemo(() => users.filter((user) => (
    user.role === "mechanic"
    && user.active
    && user.membership_active
  )), [users]);

  async function loadDevices() {
    const result = await api(`/api/admin/locations/${encodeURIComponent(locationId)}/kiosk-devices`);
    setDevices(result.devices || []);
    setState((current) => ({ ...current, error: "", loading: false }));
  }

  useEffect(() => {
    setSelectedMechanicId("");
    setPin(DEFAULT_TEMPORARY_KIOSK_PIN);
    setPinError("");
    setConfirmation(DEFAULT_TEMPORARY_KIOSK_PIN);
    setState({ busy: "", error: "", loading: true, message: "" });
    loadDevices().catch((error) => {
      setState((current) => ({ ...current, error: error.message, loading: false }));
    });
  }, [locationId]);

  async function registerBrowser(event) {
    event.preventDefault();
    if (!deviceName.trim()) return;
    setState((current) => ({ ...current, busy: "register", error: "", message: "" }));
    try {
      await api(`/api/admin/locations/${encodeURIComponent(locationId)}/kiosk-devices/register`, {
        method: "POST",
        body: JSON.stringify({ name: deviceName.trim() }),
      });
      window.dispatchEvent(new Event("kiosk-registration-changed"));
      setDeviceName("");
      await loadDevices();
      setState((current) => ({
        ...current,
        busy: "",
        message: "This browser is registered. Sign out or open kiosk from your profile.",
      }));
    } catch (error) {
      setState((current) => ({ ...current, busy: "", error: error.message }));
    }
  }

  async function revokeDevice(device) {
    setState((current) => ({ ...current, busy: device.id, error: "", message: "" }));
    try {
      await api(`/api/admin/locations/${encodeURIComponent(locationId)}/kiosk-devices/${encodeURIComponent(device.id)}/revoke`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      window.dispatchEvent(new Event("kiosk-registration-changed"));
      await loadDevices();
      setState((current) => ({
        ...current,
        busy: "",
        message: `${device.name} was revoked.`,
      }));
    } catch (error) {
      setState((current) => ({ ...current, busy: "", error: error.message }));
    }
  }

  async function issuePin(event) {
    event.preventDefault();
    if (!selectedMechanicId || !isCompleteKioskPin(pin) || pin !== confirmation) return;
    const mechanic = mechanics.find((entry) => entry.id === selectedMechanicId);
    setPinError("");
    setState((current) => ({ ...current, busy: "pin", error: "", message: "" }));
    try {
      await api(`/api/admin/locations/${encodeURIComponent(locationId)}/users/${encodeURIComponent(selectedMechanicId)}/kiosk-pin`, {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
      setPin(DEFAULT_TEMPORARY_KIOSK_PIN);
      setConfirmation(DEFAULT_TEMPORARY_KIOSK_PIN);
      setState((current) => ({
        ...current,
        busy: "",
        message: `Temporary kiosk PIN issued for ${mechanic?.name || "mechanic"}. Share it privately.`,
      }));
    } catch (error) {
      const fieldError = kioskPinFieldError(error);
      setPinError(fieldError);
      setState((current) => ({
        ...current,
        busy: "",
        error: fieldError ? "" : error.message,
      }));
    }
  }

  const pinComplete = isCompleteKioskPin(pin);
  const pinReady = selectedMechanicId
    && pinComplete
    && pin === confirmation;

  return (
    <section className="admin-kiosk-settings">
      {state.error ? <p className="admin-kiosk-error" role="alert">{state.error}</p> : null}
      {state.message ? <p className="admin-kiosk-success" role="status">{state.message}</p> : null}

      <section className="admin-panel admin-kiosk-panel">
        <header className="admin-panel-header">
          <div>
            <h2>Shop computers</h2>
            <p>Register only this browser as a kiosk for this location.</p>
          </div>
          <Button
            icon={RefreshCw01}
            onClick={() => {
              setState((current) => ({ ...current, loading: true, error: "" }));
              loadDevices().catch((error) => {
                setState((current) => ({ ...current, error: error.message, loading: false }));
              });
            }}
            disabled={state.loading}
          >
            Refresh
          </Button>
        </header>

        <form className="admin-kiosk-register" onSubmit={registerBrowser}>
          <label htmlFor="kiosk-device-name">
            <span>Computer name</span>
            <input
              id="kiosk-device-name"
              maxLength="80"
              placeholder="Example: Shop front desk"
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              required
            />
          </label>
          <Button
            variant="primary"
            icon={Monitor01}
            type="submit"
            disabled={state.busy === "register" || !deviceName.trim()}
          >
            {state.busy === "register" ? "Registering" : "Register this browser"}
          </Button>
        </form>

        <div className="admin-kiosk-device-list" aria-live="polite">
          {state.loading ? (
            <div className="admin-kiosk-empty">Loading shop computers</div>
          ) : devices.length ? devices.map((device) => (
            <article className="admin-kiosk-device" key={device.id}>
              <span className="admin-kiosk-device-icon" aria-hidden="true"><Monitor01 /></span>
              <div>
                <strong>{device.name}</strong>
                <small>
                  {device.active ? "Active" : "Revoked"}
                  {" · "}
                  Last used {formatDeviceDate(device.lastSeenAt)}
                </small>
                <small>Registered {formatDeviceDate(device.createdAt)}</small>
              </div>
              {device.active ? (
                <Button
                  className="admin-kiosk-revoke"
                  variant="danger"
                  icon={Trash01}
                  onClick={() => revokeDevice(device)}
                  disabled={Boolean(state.busy)}
                >
                  {state.busy === device.id ? "Revoking" : "Revoke"}
                </Button>
              ) : null}
            </article>
          )) : (
            <div className="admin-kiosk-empty">No shop computers registered.</div>
          )}
        </div>
      </section>

      <section className="admin-panel admin-kiosk-panel">
        <header className="admin-panel-header">
          <div>
            <h2>Mechanic kiosk PIN</h2>
            <p>Issue a one-time temporary PIN. Mechanic must replace it at first unlock.</p>
          </div>
        </header>
        {mechanics.length ? (
          <form className="admin-kiosk-pin-form" onSubmit={issuePin}>
            <label htmlFor="kiosk-mechanic">
              <span>Mechanic</span>
              <select
                id="kiosk-mechanic"
                value={selectedMechanicId}
                onChange={(event) => setSelectedMechanicId(event.target.value)}
                required
              >
                <option value="">Choose mechanic</option>
                {mechanics.map((mechanic) => (
                  <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>
                ))}
              </select>
            </label>
            <label htmlFor="admin-kiosk-pin">
              <span>Temporary PIN</span>
              <input
                id="admin-kiosk-pin"
                aria-describedby={pinError ? "admin-kiosk-pin-error" : undefined}
                aria-invalid={Boolean(pinError)}
                autoComplete="new-password"
                inputMode="numeric"
                minLength="4"
                pattern="[0-9]{4,}"
                type="password"
                value={pin}
                onChange={(event) => {
                  setPin(kioskPinValue(event.target.value));
                  setPinError("");
                }}
                required
              />
              {pinError ? (
                <small className="admin-kiosk-field-error" id="admin-kiosk-pin-error" role="alert">
                  {pinError}
                </small>
              ) : null}
            </label>
            <label htmlFor="admin-kiosk-pin-confirmation">
              <span>Confirm PIN</span>
              <input
                id="admin-kiosk-pin-confirmation"
                autoComplete="new-password"
                inputMode="numeric"
                minLength="4"
                pattern="[0-9]{4,}"
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(kioskPinValue(event.target.value))}
                required
              />
            </label>
            <Button
              variant="primary"
              icon={Key01}
              type="submit"
              disabled={state.busy === "pin" || !pinReady}
            >
              {state.busy === "pin" ? "Issuing" : "Issue temporary PIN"}
            </Button>
          </form>
        ) : (
          <div className="admin-kiosk-empty">
            Add an active mechanic to this location before issuing a kiosk PIN.
          </div>
        )}
      </section>
    </section>
  );
}
