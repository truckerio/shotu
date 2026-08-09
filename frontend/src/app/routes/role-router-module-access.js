import { roleCanCreateWorkorderForAnyLocation } from "./role-capabilities.js";

export function activeWorkorderModulePolicy({ activeWorkorder = null, selectedOfficeLocation = null } = {}) {
  return activeWorkorder?.workorder?.policy
    || activeWorkorder?.workorder?.location?.policy
    || activeWorkorder?.policy
    || selectedOfficeLocation?.policy
    || null;
}

export function canOpenCreateWorkspaceForActor({ actor, locations = [] } = {}) {
  return roleCanCreateWorkorderForAnyLocation(actor?.role, locations, actor?.id);
}
