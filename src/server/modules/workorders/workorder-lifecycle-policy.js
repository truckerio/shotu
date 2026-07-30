export const WORKORDER_LIFECYCLES = Object.freeze([
  "open",
  "accepted",
  "in_progress",
  "mechanic_done",
  "closed",
  "odoo_entered",
  "cancelled",
]);

export const OPERATIONS_ACTIVE_LIFECYCLES = Object.freeze([
  "accepted",
  "in_progress",
  "mechanic_done",
]);

export const MECHANIC_ACTIVE_LIFECYCLES = Object.freeze([
  "accepted",
  "in_progress",
]);

export const MECHANIC_HISTORY_LIFECYCLES = Object.freeze([
  "mechanic_done",
  "closed",
  "odoo_entered",
]);

export const SURVEILLANCE_VISIBLE_LIFECYCLES = Object.freeze([
  "accepted",
  "in_progress",
  "mechanic_done",
  "closed",
  "odoo_entered",
]);

export const ODOO_ELIGIBLE_LIFECYCLES = Object.freeze([
  "closed",
  "odoo_entered",
]);

export function lifecycleIn(status, allowed) {
  return allowed.includes(status);
}
