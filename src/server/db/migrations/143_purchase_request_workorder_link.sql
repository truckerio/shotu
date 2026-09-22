set local lock_timeout = '5s';
alter table inventory_purchase_requests add column workorder_id uuid;
alter table inventory_purchase_requests add constraint purchase_request_workorder_company_fkey
  foreign key(company_id,workorder_id) references operational_workorders(company_id,id);
create index inventory_purchase_request_workorder on inventory_purchase_requests(company_id,workorder_id,created_at);

-- Recover the exact reference written by the original work order request dialog.
update inventory_purchase_requests r set workorder_id=wo.id
from operational_workorders wo
where r.workorder_id is null and r.company_id=wo.company_id and r.location_id=wo.location_id
  and r.category='part_request' and r.notes='Work order '||wo.serial;
