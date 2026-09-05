create index if not exists workorder_serialized_usage_asset_custody_idx
  on workorder_serialized_part_usages(company_id, asset_id, issued_at desc, id)
  where status in ('installed_pending_approval', 'installed', 'removed');

comment on index workorder_serialized_usage_asset_custody_idx is
  'Supports Units custody discovery when an asset has no assigned home location.';
