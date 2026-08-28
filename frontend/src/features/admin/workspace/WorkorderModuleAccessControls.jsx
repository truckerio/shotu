import { Dropdown } from "../../../components/forms/Dropdown.jsx";
import {
  normalizeModuleAccessMap,
  WORKORDER_ACCESS_MODES,
  WORKORDER_INHERIT_ACCESS,
  WORKORDER_MODULES,
  WORKORDER_ROLES,
  WORKORDER_SURFACES,
} from "../../../../../shared/workorder-modules.js";

export const ROLE_LABELS = Object.freeze({
  mechanic: "Mechanic",
  office: "Office",
  surveillance: "Surveillance",
  admin: "Admin",
});

export const MODE_LABELS = Object.freeze({
  hidden: "Hidden",
  read: "Read only",
  write: "Write",
  required: "Required",
});

export const USER_MODE_LABELS = Object.freeze({
  [WORKORDER_INHERIT_ACCESS]: "Use role setting",
  ...MODE_LABELS,
});

export function moduleSurfaceList(surface) {
  return WORKORDER_MODULES.filter((module) => module.surfaces.includes(surface));
}

export function ModuleAccessSelect({ label = "Access", value, onChange, includeInherit = false }) {
  const modes = includeInherit
    ? [WORKORDER_INHERIT_ACCESS, ...Object.values(WORKORDER_ACCESS_MODES)]
    : Object.values(WORKORDER_ACCESS_MODES);
  const labels = includeInherit ? USER_MODE_LABELS : MODE_LABELS;
  return (
    <label className="admin-module-select" role="cell">
      <span>{label}</span>
      <Dropdown value={value} onChange={(event) => onChange(event.target.value)}>
        {modes.map((mode) => (
          <option key={mode} value={mode}>{labels[mode]}</option>
        ))}
      </Dropdown>
    </label>
  );
}

export function RoleModuleAccessTable({ moduleAccess, onChange, surface }) {
  const access = normalizeModuleAccessMap(moduleAccess);
  return (
    <div className="admin-module-grid" role="table" aria-label={`${surface} module access`}>
      <div className="admin-module-grid-head" role="row">
        <span role="columnheader">Block</span>
        {WORKORDER_ROLES.map((role) => <span key={role} role="columnheader">{ROLE_LABELS[role]}</span>)}
      </div>
      {moduleSurfaceList(surface).map((module) => (
        <div className="admin-module-grid-row" role="row" key={module.key}>
          <span className="admin-module-name" role="cell">
            <strong>{module.label}</strong>
            <small>{module.description}</small>
          </span>
          {WORKORDER_ROLES.map((role) => (
            <ModuleAccessSelect
              key={role}
              label={ROLE_LABELS[role]}
              value={access[role][surface][module.key]}
              onChange={(value) => onChange(role, surface, module.key, value)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function roleDefaultLabel(moduleAccess, role, surface, moduleKey) {
  const access = normalizeModuleAccessMap(moduleAccess);
  return MODE_LABELS[access[role]?.[surface]?.[moduleKey]] || MODE_LABELS.hidden;
}

function exceptionValue(value, surface, moduleKey) {
  return value?.[surface]?.[moduleKey] || WORKORDER_INHERIT_ACCESS;
}

export function countUserModuleExceptions(value = {}) {
  return Object.values(WORKORDER_SURFACES).reduce((total, surface) => (
    total + Object.keys(value?.[surface] || {}).length
  ), 0);
}

export function UserModuleAccessEditor({ moduleAccess, onChange, user, value }) {
  const exceptionCount = countUserModuleExceptions(value);

  function updateException(surface, moduleKey, mode) {
    const next = structuredClone(value || {});
    const surfaceAccess = { ...(next[surface] || {}) };
    if (mode === WORKORDER_INHERIT_ACCESS) {
      delete surfaceAccess[moduleKey];
    } else {
      surfaceAccess[moduleKey] = mode;
    }
    if (Object.keys(surfaceAccess).length) next[surface] = surfaceAccess;
    else delete next[surface];
    onChange(next);
  }

  return (
    <section className="admin-permission-editor">
      <div className="admin-permission-user-card">
        <span>
          <strong>{user.name}</strong>
          <small>{ROLE_LABELS[user.role] || user.role} · {user.username ? `@${user.username}` : user.email}</small>
        </span>
        <span className={`admin-permission-state ${exceptionCount ? "custom" : ""}`}>
          {exceptionCount ? `${exceptionCount} custom` : "Role default"}
        </span>
      </div>

      <div className="admin-permission-toolbar">
        <p>Leave unchanged blocks on role default.</p>
        <button type="button" onClick={() => onChange({})} disabled={!exceptionCount}>Reset to default</button>
      </div>

      {Object.values(WORKORDER_SURFACES).map((surface) => (
        <div className="admin-permission-table" key={surface}>
          <div className="admin-permission-table-title">
            <strong>{surface === WORKORDER_SURFACES.CREATE ? "Create workorder" : "Workorder detail"}</strong>
            <small>{surface === WORKORDER_SURFACES.CREATE ? "Create form blocks." : "Detail page blocks."}</small>
          </div>
          <div className="admin-module-grid admin-user-module-grid" role="table" aria-label={`${surface} module exceptions for ${user.name}`}>
            <div className="admin-module-grid-head" role="row">
              <span role="columnheader">Block</span>
              <span role="columnheader">Role default</span>
              <span role="columnheader">This user</span>
            </div>
            {moduleSurfaceList(surface).map((module) => (
              <div className="admin-module-grid-row" role="row" key={module.key}>
                <span className="admin-module-name" role="cell">
                  <strong>{module.label}</strong>
                  <small>{module.description}</small>
                </span>
                <span className="admin-module-default" role="cell">
                  {roleDefaultLabel(moduleAccess, user.role, surface, module.key)}
                </span>
                <ModuleAccessSelect
                  includeInherit
                  label="This user"
                  value={exceptionValue(value, surface, module.key)}
                  onChange={(mode) => updateException(surface, module.key, mode)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
