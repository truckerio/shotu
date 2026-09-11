-- A backorder without a selected source must remain valid when cancelled.
-- Active internal transfers still require a distinct source location.
alter table part_fulfillment_legs
  drop constraint part_fulfillment_leg_route_shape;

alter table part_fulfillment_legs
  add constraint part_fulfillment_leg_route_shape check (
    (route_type = 'destination_stock' and source_location_id is null)
    or (route_type = 'internal_transfer' and source_location_id is not null and source_location_id <> destination_location_id)
    or (route_type = 'internal_transfer' and state in ('backordered', 'cancelled') and source_location_id is null)
  );
