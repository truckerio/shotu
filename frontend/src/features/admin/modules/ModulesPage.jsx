import { Dropdown } from "../../../components/forms/Dropdown.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { SearchMd, Settings01, Shield03 } from "@untitledui/icons";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { ContextBreadcrumbs } from "../../../components/ui/ContextBreadcrumbs.jsx";
import { isPlainPrimaryActivation } from "../../../components/ui/context-navigation.js";
import { Pagination, usePagination } from "../../../components/ui/Pagination.jsx";
import {
  WORKORDER_ACCESS_MODES,
  WORKORDER_INHERIT_ACCESS,
  WORKORDER_MODULES,
  WORKORDER_ROLES,
  WORKORDER_SURFACES,
} from "../../../../../shared/workorder-modules.js";
import {
  effectiveModuleAccess,
  filterAdminModules,
  MODULE_ACCESS_LABELS,
  moduleAccessOptions,
  moduleAccessOverride,
  moduleSupportsWrite,
  presentedModuleAccess,
  updateModuleAccessOverride,
  updateUserModuleException,
  userModuleException,
} from "./module-admin-model.js";
import "./modules.css";

const ROLE_LABELS = Object.freeze({
  mechanic: "Mechanic",
  office: "Office",
  surveillance: "Surveillance",
  admin: "Admin",
});

const SURFACE_LABELS = Object.freeze({
  [WORKORDER_SURFACES.CREATE]: "Create workorder",
  [WORKORDER_SURFACES.DETAIL]: "Workorder detail",
});

function AccessSelect({ includeInherit = false, inheritLabel = "Use inherited setting", label, module, note = "", onChange, role, surface, value }) {
  const options = moduleAccessOptions(module, { includeInherit, role, surface });
  const presentedValue = value === WORKORDER_INHERIT_ACCESS
    ? value
    : presentedModuleAccess(module, value, { role, surface });
  return (
    <label className="admin-modules-access-field">
      <span>{label}</span>
      <Dropdown aria-label={label} value={presentedValue} onChange={(event) => onChange(event.target.value)}>
        {options.map((mode) => (
          <option key={mode} value={mode}>{mode === WORKORDER_INHERIT_ACCESS ? inheritLabel : MODULE_ACCESS_LABELS[mode]}</option>
        ))}
      </Dropdown>
      {note ? <small>{note}</small> : null}
    </label>
  );
}

function ModuleCard({ companyPolicy, locationPolicy, module, onManage }) {
  const primarySurface = module.surfaces.includes(WORKORDER_SURFACES.DETAIL)
    ? WORKORDER_SURFACES.DETAIL
    : module.surfaces[0];
  return (
    <article className="admin-module-card">
      <header>
        <span className="admin-module-card-icon" aria-hidden="true"><Shield03 /></span>
        <span>
          <strong>{module.label}</strong>
          <small>{module.description}</small>
        </span>
      </header>
      <div className="admin-module-card-surfaces" aria-label="Available pages">
        {module.surfaces.map((surface) => <span key={surface}>{SURFACE_LABELS[surface]}</span>)}
      </div>
      <dl className="admin-module-role-summary">
        {WORKORDER_ROLES.map((role) => {
          const effective = effectiveModuleAccess({
            companyPolicy,
            locationPolicy,
            moduleKey: module.key,
            role,
            surface: primarySurface,
          });
          return (
            <div key={role}>
              <dt>{ROLE_LABELS[role]}</dt>
              <dd data-access={presentedModuleAccess(module, effective.access, { role, surface: primarySurface })} title={effective.sourceLabel}>
                {MODULE_ACCESS_LABELS[presentedModuleAccess(module, effective.access, { role, surface: primarySurface })]}
              </dd>
            </div>
          );
        })}
      </dl>
      <Button onClick={() => onManage(module.key)}>Manage</Button>
    </article>
  );
}

function UserExceptions({ companyPolicy, module, policy, scopeType, setPolicy, surface, users }) {
  const [selectedUserId, setSelectedUserId] = useState("");
  const activeUsers = users.filter((user) => user.active && user.membership_active);
  const user = activeUsers.find((item) => item.id === selectedUserId) || null;
  const exception = user
    ? userModuleException(policy, user.id, surface, module.key)
    : WORKORDER_INHERIT_ACCESS;
  const effective = user ? effectiveModuleAccess({
    companyPolicy: scopeType === "company" ? policy : companyPolicy,
    locationPolicy: scopeType === "location" ? policy : null,
    moduleKey: module.key,
    role: user.role,
    surface,
    userId: user.id,
  }) : null;
  const configuredCount = Object.values(policy?.userModuleAccess || {}).filter((entry) => (
    Boolean(entry?.[surface]?.[module.key])
  )).length;

  useEffect(() => {
    if (selectedUserId && !activeUsers.some((item) => item.id === selectedUserId)) setSelectedUserId("");
  }, [activeUsers, selectedUserId]);

  return (
    <details className="admin-module-exceptions">
      <summary>
        <span>
          <strong>User exceptions</strong>
          <small>Override the {scopeType === "company" ? "company setting" : "location setting"} for one person.</small>
        </span>
        <span>{configuredCount} configured</span>
      </summary>
      <div className="admin-module-exception-body">
        <label className="admin-modules-user-picker">
          <span>User</span>
          <Dropdown aria-label="User" value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
            <option value="">Choose a user</option>
            {activeUsers.map((item) => (
              <option key={item.id} value={item.id}>{item.name} · {ROLE_LABELS[item.role] || item.role}</option>
            ))}
          </Dropdown>
        </label>
        {user ? (
          <div className="admin-module-user-setting">
            <div className="admin-module-user-controls">
              <AccessSelect
                includeInherit
                inheritLabel={scopeType === "company" ? "Use company role setting" : "Use location role setting"}
                label={`${module.label} access`}
                module={module}
                role={user.role}
                surface={surface}
                value={exception}
                onChange={(access) => setPolicy((current) => (
                  updateUserModuleException(current, user.id, surface, module.key, access)
                ))}
              />
              {surface === WORKORDER_SURFACES.CREATE && moduleSupportsWrite(module, { role: user.role, surface }) ? (
                <label className="admin-module-required-setting admin-module-user-required-setting">
                  <input
                    type="checkbox"
                    checked={effective.access === WORKORDER_ACCESS_MODES.REQUIRED}
                    onChange={(event) => setPolicy((current) => updateUserModuleException(
                      current,
                      user.id,
                      surface,
                      module.key,
                      event.target.checked ? WORKORDER_ACCESS_MODES.REQUIRED : WORKORDER_ACCESS_MODES.WRITE,
                    ))}
                  />
                  <span>Required to create</span>
                </label>
              ) : null}
            </div>
            <p>
              Effective access: <strong>{MODULE_ACCESS_LABELS[presentedModuleAccess(module, effective.access, { role: user.role, surface })]}</strong>
              <span>{effective.sourceLabel}</span>
            </p>
          </div>
        ) : <p className="admin-module-muted">Choose a user to view or change their exception.</p>}
      </div>
    </details>
  );
}

function ModuleManager({
  companyPolicy,
  companyUsers,
  detail,
  module,
  onBack,
  onSave,
  scopePolicy,
  scopeType,
  saving,
  setLocationPolicy,
  setScopePolicy,
}) {
  const titleRef = useRef(null);
  const [surface, setSurface] = useState(() => (
    module.surfaces.includes(WORKORDER_SURFACES.DETAIL)
      ? WORKORDER_SURFACES.DETAIL
      : module.surfaces[0]
  ));

  useEffect(() => {
    if (!module.surfaces.includes(surface)) setSurface(module.surfaces[0]);
  }, [module, surface]);

  useEffect(() => titleRef.current?.focus(), [module.key]);

  function followModulesBreadcrumb(event) {
    if (!isPlainPrimaryActivation(event)) return;
    event.preventDefault();
    onBack();
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const origin = [...document.querySelectorAll(".admin-module-card")]
        .find((card) => card.querySelector("header strong")?.textContent?.trim() === module.label);
      origin?.querySelector("button")?.focus({ preventScroll: true });
    }));
  }

  return (
    <section className="admin-module-manager" aria-labelledby="admin-module-manager-title">
      <header className="admin-module-manager-header">
        <ContextBreadcrumbs
          items={[{
            label: "Modules",
            href: "/?adminView=modules",
            onClick: followModulesBreadcrumb,
          }]}
          current={module.label}
        />
        <div>
          <span className="admin-module-card-icon" aria-hidden="true"><Shield03 /></span>
          <span>
            <h2 id="admin-module-manager-title" ref={titleRef} tabIndex="-1">{module.label}</h2>
            <p>{module.description}</p>
          </span>
        </div>
        <Button variant="primary" onClick={onSave} disabled={saving}>{saving ? "Saving" : "Save access"}</Button>
      </header>

      {module.surfaces.length > 1 ? (
        <div className="admin-module-surface-tabs" role="tablist" aria-label={`${module.label} pages`}>
          {module.surfaces.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={surface === item}
              className={surface === item ? "active" : ""}
              onClick={() => setSurface(item)}
            >
              {SURFACE_LABELS[item]}
            </button>
          ))}
        </div>
      ) : <p className="admin-module-single-surface">Available on {SURFACE_LABELS[surface]}</p>}

      <section className="admin-module-role-editor" aria-labelledby="admin-module-role-title">
        <header>
          <h3 id="admin-module-role-title">Role access</h3>
          <p>
            {scopeType === "company"
              ? "Company defaults apply unless a location or user overrides them."
              : `Overrides apply only at ${detail.location.name}. User exceptions can override them.`}
          </p>
        </header>
        <div className="admin-module-role-list">
          {WORKORDER_ROLES.map((role) => {
            const effective = effectiveModuleAccess({
              companyPolicy: scopeType === "company" ? scopePolicy : companyPolicy,
              locationPolicy: scopeType === "location" ? scopePolicy : null,
              moduleKey: module.key,
              role,
              surface,
            });
            const override = moduleAccessOverride(scopePolicy, role, surface, module.key);
            return (
              <div className="admin-module-role-control" key={role}>
                <AccessSelect
                  includeInherit
                  inheritLabel={scopeType === "company" ? "Use system default" : "Use company default"}
                  label={ROLE_LABELS[role]}
                  module={module}
                  note={`${MODULE_ACCESS_LABELS[presentedModuleAccess(module, effective.access, { role, surface })]} · ${effective.sourceLabel}`}
                  role={role}
                  surface={surface}
                  value={override}
                  onChange={(access) => setScopePolicy((current) => (
                    updateModuleAccessOverride(current, role, surface, module.key, access)
                  ))}
                />
                {surface === WORKORDER_SURFACES.CREATE && moduleSupportsWrite(module, { role, surface }) ? (
                  <label className="admin-module-required-setting">
                    <input
                      type="checkbox"
                      checked={effective.access === WORKORDER_ACCESS_MODES.REQUIRED}
                      onChange={(event) => setScopePolicy((current) => updateModuleAccessOverride(
                        current,
                        role,
                        surface,
                        module.key,
                        event.target.checked ? WORKORDER_ACCESS_MODES.REQUIRED : WORKORDER_ACCESS_MODES.WRITE,
                      ))}
                    />
                    <span>Required to create</span>
                  </label>
                ) : null}
              </div>
            );
          })}
        </div>
        {!moduleSupportsWrite(module) ? (
          <p className="admin-module-view-only">This module is view-only and has no edit actions.</p>
        ) : null}
      </section>

      {detail || scopeType === "company" ? (
        <UserExceptions
          companyPolicy={companyPolicy}
          module={module}
          policy={scopePolicy}
          scopeType={scopeType}
          setPolicy={scopeType === "company" ? setScopePolicy : setLocationPolicy}
          surface={surface}
          users={scopeType === "company" ? companyUsers : detail?.users || []}
        />
      ) : null}

      <aside className="admin-module-explanation" aria-label="Access order">
        <Settings01 aria-hidden="true" />
        <span>
          <strong>How access is decided</strong>
          <small>
            {scopeType === "company"
              ? "System defaults are the safe baseline. Company defaults override them when set."
              : "A user exception wins first, then a location override, then the company default, then the system default."}
          </small>
        </span>
      </aside>
    </section>
  );
}

export function ModulesPage({
  catalog,
  companyId,
  companyPolicy,
  companyUsers,
  detail,
  locations,
  onSave,
  onSelectScope,
  policy,
  saving,
  scopeType,
  setCompanyPolicy,
  setPolicy,
}) {
  const [query, setQuery] = useState("");
  const [activeModuleKey, setActiveModuleKey] = useState("");
  const catalogModules = catalog?.modules || WORKORDER_MODULES;
  const modules = useMemo(() => filterAdminModules(catalogModules, query), [catalogModules, query]);
  const pagination = usePagination(modules, { pageSize: 12, resetKey: query });
  const activeModule = catalogModules.find((module) => module.key === activeModuleKey) || null;
  const scopePolicy = scopeType === "company" ? companyPolicy : policy;
  const setScopePolicy = scopeType === "company" ? setCompanyPolicy : setPolicy;
  const scopeValue = scopeType === "company"
    ? `company:${companyId || ""}`
    : detail?.location?.id ? `location:${detail.location.id}` : "";
  const companyOptions = [...new Map(locations.map((location) => {
    const id = location.company_id || location.companyId;
    return [id, { id, label: location.company_name || location.companyName || "Company default" }];
  }).filter(([id]) => Boolean(id))).values()];
  const hasScope = Boolean(scopeType === "company" ? companyId : detail);
  const scopeName = scopeType === "company" ? "company default" : detail?.location?.name;

  useEffect(() => setActiveModuleKey(""), [detail?.location?.id]);

  return (
    <section className="admin-content admin-modules-page">
      <PageHeader
        title="Modules"
        subtitle="Choose what each role or user can see and change."
        actions={(
          <label className="admin-modules-location-picker">
            <span>Access scope</span>
              <Dropdown aria-label="Access scope" value={scopeValue} onChange={(event) => onSelectScope(event.target.value)}>
              <option value="">Choose a scope</option>
              <optgroup label="Company">
                {companyOptions.map((company) => <option key={company.id} value={`company:${company.id}`}>{company.label}</option>)}
              </optgroup>
              <optgroup label="Location overrides">
                {locations.map((location) => <option key={location.id} value={`location:${location.id}`}>{location.name}</option>)}
              </optgroup>
            </Dropdown>
          </label>
        )}
      />

      {!hasScope ? (
        <div className="admin-modules-empty">
          <Shield03 aria-hidden="true" />
          <h2>Choose an access scope</h2>
          <p>Start with the company default, then add location overrides only where needed.</p>
        </div>
      ) : activeModule ? (
        <ModuleManager
          detail={detail}
          module={activeModule}
          onBack={() => setActiveModuleKey("")}
          onSave={onSave}
          companyPolicy={companyPolicy}
          companyUsers={companyUsers}
          scopePolicy={scopePolicy}
          scopeType={scopeType}
          saving={saving}
          setLocationPolicy={setPolicy}
          setScopePolicy={setScopePolicy}
        />
      ) : (
        <>
          <div className="admin-modules-toolbar">
            <label>
              <SearchMd aria-hidden="true" />
              <input aria-label="Search modules" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search modules" />
            </label>
            <p><strong>{catalogModules.length}</strong> modules · {scopeName}</p>
          </div>
          {modules.length ? (<>
            <div className="admin-module-cards">
              {pagination.pageItems.map((module) => (
                <ModuleCard
                  companyPolicy={companyPolicy}
                  key={module.key}
                  locationPolicy={scopeType === "location" ? policy : null}
                  module={module}
                  onManage={setActiveModuleKey}
                />
              ))}
            </div>
            <Pagination {...pagination} label="modules" />
          </>) : (
            <div className="admin-modules-empty compact">
              <h2>No matching modules</h2>
              <button type="button" onClick={() => setQuery("")}>Clear search</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
