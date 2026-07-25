-- The assignment table is the only mechanic ownership source.

do $$
begin
  if exists (
    select 1
    from operational_workorders workorder
    left join workorder_mechanic_assignments assignment
      on assignment.workorder_id = workorder.id
     and assignment.active
     and assignment.assignment_role = 'primary'
    where workorder.current_mechanic_id is distinct from assignment.mechanic_user_id
  ) then
    raise exception 'Cannot remove current_mechanic_id while assignment drift exists';
  end if;
end;
$$;

drop index if exists operational_workorders_current_mechanic_idx;
alter table operational_workorders drop column current_mechanic_id;

comment on table workorder_mechanic_assignments is
  'Canonical workorder mechanic team. At most one active primary assignment; support assignments remain explicit.';
