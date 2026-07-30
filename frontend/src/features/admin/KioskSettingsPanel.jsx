import { useEffect, useState } from "react";
import { Monitor01, RefreshCw01, Trash01 } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { textEntryProps } from "../../components/forms/text-entry-policy.js";
import { api } from "../../lib/api.js";
import "./kiosk-settings.css";

function formatDeviceDate(value) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function KioskSettingsPanel({ locationId }) {
  const [devices, setDevices] = useState([]);
  const [deviceName, setDeviceName] = useState("");
  const [state, setState] = useState({
    busy: "",
    error: "",
    loading: true,
    message: "",
  });

  async function loadDevices() {
    const result = await api(`/api/admin/locations/${encodeURIComponent(locationId)}/kiosk-devices`);
    setDevices(result.devices || []);
    setState((current) => ({ ...current, error: "", loading: false }));
  }

  useEffect(() => {
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
              {...textEntryProps("name")}
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
    </section>
  );
}
