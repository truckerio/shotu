import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { api } from "../../../lib/api.js";
import { businessSetupUrl } from "./business-setup-model.js";

export function BusinessSetupPrompt({ locations = [] }) {
  const companies = [...new Map(locations.map(location => [location.company_id || location.companyId, location.id])).entries()];
  const scope = JSON.stringify(companies);
  const [pending, setPending] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(companies.map(async ([companyId, locationId]) => {
      if (!companyId) return null;
      try {
        const data = await api(`/api/admin/business-setup?${new URLSearchParams({ companyId, ...(locationId ? { locationId } : {}) })}`, { signal: controller.signal });
        return data.setup?.status !== "completed" && !data.billing.ready ? { companyId, locationId } : null;
      } catch { return null; }
    })).then(results => { if (!controller.signal.aborted) setPending({ scope, target: results.find(Boolean) }); });
    return () => controller.abort();
  }, [scope]);
  const target = pending?.scope === scope ? pending.target : null;
  return target ? <Button type="button" onClick={() => window.location.assign(businessSetupUrl(target.companyId, target.locationId))}>Finish business setup</Button> : null;
}
