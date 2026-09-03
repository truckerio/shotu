import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api.js";
import { Dropdown } from "../../../components/forms/Dropdown.jsx";
import { productModuleCompatibilityDefault } from "../../../../../shared/product-modules.js";
import "./product-module-access-panel.css";

const roles = [["admin", "Administrators"], ["office", "Office"], ["mechanic", "Mechanics"], ["surveillance", "Guards / dispatch"]];
const modules = [["workorders", "Workorders"], ["inspections", "Inspections"]];
function key(role, moduleKey) { return `${role}:${moduleKey}`; }

export function ProductModuleAccessPanel({ companyId, locationId = null }) {
  const [rules, setRules] = useState(new Map());
  const [state, setState] = useState({ loading: false, saving: "", error: "" });
  const load = useCallback(async () => {
    if (!companyId) return;
    setState((value) => ({ ...value, loading: true, error: "" }));
    try {
      const params = new URLSearchParams({ companyId });
      if (locationId) params.set("locationId", locationId);
      const result = await api(`/api/admin/product-modules?${params}`);
      setRules(new Map((result.rules || []).filter((rule) => rule.subjectType === "role").map((rule) => [key(rule.subjectId, rule.moduleKey), rule])));
      setState({ loading: false, saving: "", error: "" });
    } catch (error) { setState({ loading: false, saving: "", error: error.message }); }
  }, [companyId, locationId]);
  useEffect(() => { load(); }, [load]);

  async function save(role, moduleKey, mode) {
    const ruleKey = key(role, moduleKey);
    const current = rules.get(ruleKey);
    setState((value) => ({ ...value, saving: ruleKey, error: "" }));
    try {
      await api("/api/admin/product-modules", { method: "PATCH", body: JSON.stringify({ companyId, locationId, subjectType: "role", subjectId: role, moduleKey, mode, expectedVersion: current?.version || 0 }) });
      await load();
    } catch (error) { setState((value) => ({ ...value, saving: "", error: error.message })); }
  }

  if (!companyId) return null;
  return <section className="product-module-panel" aria-labelledby="product-access-title">
    <div><h2 id="product-access-title">Workspaces</h2><p>{locationId ? "Location access" : "Company access"}</p></div>
    {state.error ? <p role="alert" className="admin-error">{state.error}</p> : null}
    <div className="product-module-grid">
      <span aria-hidden="true" />{modules.map(([, label]) => <strong key={label}>{label}</strong>)}
      {roles.map(([role, label]) => <ProductRoleRow key={role} role={role} label={label} rules={rules} saving={state.saving} onSave={save} locationScoped={Boolean(locationId)} />)}
    </div>
  </section>;
}

function ProductRoleRow({ role, label, rules, saving, onSave, locationScoped }) {
  return <><strong>{label}</strong>{modules.map(([moduleKey]) => {
    const rule = rules.get(key(role, moduleKey));
    const fallback = productModuleCompatibilityDefault(moduleKey, role);
    const fallbackLabel = fallback === "full" ? "Full" : fallback === "read" ? "Read" : "Off";
    return <label key={moduleKey}><span className="sr-only">{label} {moduleKey}</span><Dropdown value={rule?.mode || "inherit"} disabled={saving === key(role, moduleKey)} onChange={(event) => onSave(role, moduleKey, event.target.value)}><option value="inherit">{locationScoped ? "Company setting" : `Default (${fallbackLabel})`}</option><option value="off">Off</option><option value="read">Read</option><option value="full">Full</option></Dropdown></label>;
  })}</>;
}
