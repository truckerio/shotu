import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { api } from "../../../lib/api.js";
import { commercialProfileInitialScope } from "../../customer-documents/commercial-profile-navigation.js";
import { CommercialProfileSettings } from "../commercial/CommercialProfileSettings.jsx";
import "./business-setup.css";

export function BusinessSetupBilling({ locations, onBack }) {
  const { companyId, locationId } = commercialProfileInitialScope(locations, window.location.search);
  const scopeKey = `${companyId}:${locationId}`;
  const [loaded, setLoaded] = useState(null);
  const data = loaded?.scope === scopeKey ? loaded.data : null;
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!companyId) return;
    const controller = new AbortController();
    setLoaded(null); setError("");
    api(`/api/admin/business-setup?${new URLSearchParams({ companyId, ...(locationId ? { locationId } : {}) })}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setLoaded({ scope: scopeKey, data: value }); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [companyId, locationId, scopeKey, reload]);
  return <><div className="admin-content business-setup-billing-back"><Button onClick={onBack}>Back to business setup</Button>{!locationId ? <p className="business-setup-note">Company-wide billing defaults. Existing location settings stay in place.</p> : null}{error ? <><p role="alert">{error}</p><Button onClick={() => setReload(value => value + 1)}>Retry setup</Button></> : !data ? <p role="status">Loading billing settings…</p> : null}</div>{data ? <CommercialProfileSettings key={scopeKey} scopeLocked locations={locations.filter(location => (location.company_id || location.companyId) === companyId && (!locationId || location.id === locationId))} initialShopIdentity={data.setup?.shopIdentity || data.defaults} /> : null}</>;
}
