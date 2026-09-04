set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Add explicit non-null evidence guards without rewriting applied migration113.
-- No backfill: invalid pre-existing cases require reviewed repair, not fabricated evidence.
alter table inventory_reuse_cases
  add constraint inventory_reuse_received_evidence_required check (
    status = 'awaiting_handoff'
    or (received_by_user_id is not null and coalesce(length(trim(receipt_evidence)),0) > 0)
  ),
  add constraint inventory_reuse_release_evidence_required check (
    status <> 'released'
    or (released_by_user_id is not null and ownership = 'company'
      and coalesce(length(trim(inspection_evidence)),0) > 0)
  );
alter table inventory_reuse_operations
  add constraint inventory_reuse_operation_request_hash_shape
  check (request_hash ~ '^[0-9a-f]{64}$');
