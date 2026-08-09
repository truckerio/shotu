import { useState } from "react";
import { api } from "../../../lib/api.js";

function companyIdFor(location) {
  return location?.company_id || location?.companyId || "";
}

function uniqueUsers(details) {
  const users = new Map();
  for (const detail of details) {
    for (const user of detail?.users || []) users.set(user.id, user);
  }
  return [...users.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function useAdminModulesController({ setDetail, setSelectedId, setState, setView }) {
  const [catalog, setCatalog] = useState(null);
  const [companyId, setCompanyId] = useState("");
  const [companyPolicy, setCompanyPolicy] = useState({ moduleAccess: {}, userModuleAccess: {}, version: 1 });
  const [companyUsers, setCompanyUsers] = useState([]);
  const [scopeType, setScopeType] = useState("");

  async function loadCatalog() {
    const result = await api("/api/admin/module-catalog");
    setCatalog(result.catalog || null);
  }

  async function loadCompanyPolicy(nextCompanyId) {
    const result = await api(`/api/admin/companies/${nextCompanyId}/module-policy`);
    setCompanyId(nextCompanyId);
    setCompanyPolicy(result.policy || {
      companyId: nextCompanyId,
      moduleAccess: {},
      userModuleAccess: {},
      version: 1,
    });
    return result.policy;
  }

  async function activateLocation(location, nextView) {
    if (nextView !== "modules") return;
    await loadCompanyPolicy(companyIdFor(location));
    setScopeType("location");
  }

  async function openCompany(nextCompanyId, locations = []) {
    setState((current) => ({ ...current, loading: true, error: "" }));
    const companyLocations = locations.filter((location) => companyIdFor(location) === nextCompanyId);
    const [loadedPolicy, locationDetails] = await Promise.all([
      loadCompanyPolicy(nextCompanyId),
      Promise.all(companyLocations.map((location) => api(`/api/admin/locations/${location.id}`))),
    ]);
    setCompanyUsers(uniqueUsers(locationDetails));
    setCompanyPolicy(loadedPolicy || { companyId: nextCompanyId, moduleAccess: {}, userModuleAccess: {}, version: 1 });
    setView("modules");
    setScopeType("company");
    setSelectedId(null);
    setDetail(null);
    setState((current) => ({ ...current, loading: false }));
    window.history.replaceState({}, "", `/?adminView=modules&company=${encodeURIComponent(nextCompanyId)}`);
  }

  async function saveCompany() {
    setState((current) => ({ ...current, busy: true, error: "", message: "" }));
    try {
      const result = await api(`/api/admin/companies/${companyId}/module-policy`, {
        method: "PATCH",
        body: JSON.stringify({
          moduleAccess: companyPolicy.moduleAccess || {},
          userModuleAccess: companyPolicy.userModuleAccess || {},
          expectedVersion: companyPolicy.version,
        }),
      });
      setCompanyPolicy(result.policy);
      setState((current) => ({ ...current, busy: false, message: "Company module defaults saved." }));
    } catch (error) {
      if (error.status === 409 || error.code === "WORKORDER_MODULE_POLICY_CONFLICT") {
        await loadCompanyPolicy(companyId);
        setState((current) => ({
          ...current,
          busy: false,
          error: "Module access changed elsewhere. The latest settings were loaded; review them and try again.",
        }));
        return;
      }
      setState((current) => ({ ...current, busy: false, error: error.message }));
    }
  }

  async function saveLocation({ policy, selectedId, setPolicy }) {
    setState((current) => ({ ...current, busy: true, error: "", message: "" }));
    try {
      const result = await api(`/api/admin/locations/${selectedId}/workorder-policy`, {
        method: "PATCH",
        body: JSON.stringify({
          mechanicCanRecordParts: policy.mechanicCanRecordParts,
          moduleAccess: policy.moduleAccessOverrides || policy.moduleAccess || {},
          userModuleAccess: policy.userModuleAccess || {},
          expectedVersion: policy.version,
        }),
      });
      setPolicy(result.policy);
      setDetail((current) => ({ ...current, policy: result.policy }));
      setState((current) => ({ ...current, busy: false, message: "Location module overrides saved." }));
    } catch (error) {
      if (error.status === 409 || error.code === "WORKORDER_MODULE_POLICY_CONFLICT") {
        const latest = await api(`/api/admin/locations/${selectedId}/workorder-policy`);
        setPolicy(latest.policy);
        setDetail((current) => ({ ...current, policy: latest.policy }));
        setState((current) => ({
          ...current,
          busy: false,
          error: "Module access changed elsewhere. The latest settings were loaded; review them and try again.",
        }));
        return;
      }
      setState((current) => ({ ...current, busy: false, error: error.message }));
    }
  }

  function clearScope() {
    setScopeType("");
    setSelectedId(null);
    setDetail(null);
    window.history.replaceState({}, "", "/?adminView=modules");
  }

  async function initialize({ initialView, loadLocations, openLocation, search }) {
    const params = new URLSearchParams(search);
    const locationId = params.get("adminLocation");
    const directCompanyId = params.get("company");
    const [locations] = await Promise.all([loadLocations(), loadCatalog()]);
    if (locationId) {
      await openLocation(locationId, "work", initialView === "modules" ? "modules" : "locations");
    } else if (initialView === "modules" && directCompanyId) {
      await openCompany(directCompanyId, locations);
    }
  }

  function pageProps({ detail, locations, openLocation, policy, saving, selectedId, setPolicy }) {
    return {
      catalog,
      companyId,
      companyPolicy,
      companyUsers,
      detail,
      locations,
      policy,
      scopeType,
      saving,
      setCompanyPolicy,
      setPolicy,
      onSave: () => scopeType === "company" ? saveCompany() : saveLocation({ policy, selectedId, setPolicy }),
      onSelectScope: (value) => {
        if (!value) return clearScope();
        const [scope, id] = value.split(":");
        const request = scope === "company" ? openCompany(id, locations) : openLocation(id, "work", "modules");
        request.catch((error) => setState((current) => ({ ...current, error: error.message })));
      },
    };
  }

  return {
    activateLocation,
    companyId,
    loadCatalog,
    loadCompanyPolicy,
    initialize,
    openCompany,
    pageProps,
    scopeType,
    setScopeType,
  };
}
