export const REQUIRED_INDEXES = Object.freeze([
  "operational_workorders_company_status_idx",
  "operational_workorders_location_activity_idx",
  "workorder_mechanic_assignments_mechanic_idx",
  "workorder_status_events_workorder_idx",
  "workorder_attention_state_active_idx",
  "odoo_entry_status_status_idx",
]);

export const INDEX_RECOMMENDATIONS = Object.freeze([
  {
    key: "company_location_status_activity",
    table: "operational_workorders",
    columns: ["company_id", "location_id", "status", "updated_at"],
    reason: "Company and location scoped lifecycle queues ordered by recent activity.",
    sql: "create index concurrently on operational_workorders(company_id, location_id, status, updated_at desc);",
  },
  {
    key: "serial_search_trigram",
    table: "operational_workorders",
    columns: ["serial"],
    reason: "Serial substring search. Add pg_trgm only if captured plans show sequential-scan pressure beyond the 500-row baseline.",
    sql: "create extension if not exists pg_trgm; create index concurrently on operational_workorders using gin (serial gin_trgm_ops);",
  },
  {
    key: "concern_search_trigram",
    table: "operational_workorders",
    columns: ["concern"],
    reason: "Concern substring search. Add pg_trgm only if captured plans show sequential-scan pressure beyond the 500-row baseline.",
    sql: "create extension if not exists pg_trgm; create index concurrently on operational_workorders using gin (concern gin_trgm_ops);",
  },
]);

export const PLAN_QUERIES = Object.freeze([
  {
    key: "location_active_first_page",
    budgetMs: 50,
    minimumRows: 1,
    sql: `
      select wo.id, wo.serial, wo.status, wo.updated_at
        from operational_workorders wo
       where wo.company_id = $1
         and wo.location_id = $2
         and wo.status = any($3::text[])
       order by wo.updated_at desc
       limit $4 offset $5`,
    params: ({ companyId, locationId }) => [companyId, locationId, ["accepted", "in_progress"], 25, 0],
  },
  {
    key: "location_active_deep_page",
    budgetMs: 60,
    minimumRows: 1,
    sql: `
      select wo.id, wo.serial, wo.status, wo.updated_at
        from operational_workorders wo
       where wo.company_id = $1
         and wo.location_id = $2
         and wo.status = any($3::text[])
       order by wo.updated_at desc
       limit $4 offset $5`,
    params: ({ companyId, locationId }) => [
      companyId,
      locationId,
      ["open", "accepted", "in_progress", "mechanic_done", "closed", "odoo_entered", "cancelled"],
      25,
      475,
    ],
  },
  {
    key: "location_search",
    budgetMs: 75,
    minimumRows: 1,
    sql: `
      select wo.id, wo.serial, wo.status, wo.updated_at
        from operational_workorders wo
       where wo.company_id = $1
         and wo.location_id = $2
         and (
           wo.serial ilike '%' || $3 || '%'
           or wo.concern ilike '%' || $3 || '%'
           or coalesce(wo.form_data->>'unitNo', '') ilike '%' || $3 || '%'
         )
       order by wo.updated_at desc
       limit $4`,
    params: ({ companyId, locationId }) => [companyId, locationId, "CH-", 25],
  },
  {
    key: "mechanic_active_queue",
    budgetMs: 60,
    minimumRows: 1,
    requiresMechanic: true,
    sql: `
      select wo.id, wo.serial, wo.status, wo.updated_at
        from workorder_mechanic_assignments assignment
        join operational_workorders wo on wo.id = assignment.workorder_id
       where assignment.mechanic_user_id = $1
         and assignment.active = true
         and wo.company_id = $2
         and wo.location_id = $3
         and wo.status = any($4::text[])
       order by wo.updated_at desc
       limit $5`,
    params: ({ mechanicId, companyId, locationId }) => [mechanicId, companyId, locationId, ["accepted", "in_progress"], 100],
  },
  {
    key: "surveillance_odoo_backlog",
    budgetMs: 60,
    minimumRows: 1,
    sql: `
      select wo.id, wo.serial, wo.updated_at, coalesce(odoo.status, 'not_entered') as odoo_status
        from operational_workorders wo
        left join odoo_entry_status odoo on odoo.workorder_id = wo.id
       where wo.company_id = $1
         and wo.location_id = $2
         and wo.status = 'closed'
         and coalesce(odoo.status, 'not_entered') <> 'entered'
       order by wo.updated_at desc
       limit $3`,
    params: ({ companyId, locationId }) => [companyId, locationId, 200],
  },
]);
