set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Migration 098 allowed one inactive and one active current row for the same
-- mechanic. Reconcile that legacy shape before migration 100 enforces one row.
-- The append-only inspection_assignment_events table remains the history owner.
delete from inspection_assignments superseded
using inspection_assignments current
where superseded.company_id = current.company_id
  and superseded.inspection_id = current.inspection_id
  and superseded.mechanic_user_id = current.mechanic_user_id
  and superseded.active = false
  and current.active = true;
