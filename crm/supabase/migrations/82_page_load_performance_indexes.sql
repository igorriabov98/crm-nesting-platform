-- Indexes for the CRM pages that are opened most often.
-- All indexes use IF NOT EXISTS so repeated local/remote migration runs stay safe.

create index if not exists idx_machines_active_factory_created
  on public.machines (is_archived, factory_id, created_at desc);

create index if not exists idx_inventory_updated_material_variant
  on public.inventory (updated_at desc, material_id, material_variant_id)
  where deleted_at is null;

create index if not exists idx_supply_order_delivery_schedules_item
  on public.supply_order_delivery_schedules (request_item_table, request_item_id, delivery_date);

create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);

create index if not exists idx_tasks_assigned_deadline
  on public.tasks (assigned_to, deadline, created_at);

create index if not exists idx_production_stages_open_deadline
  on public.production_stages (planned_date_end, machine_id)
  where date_end is null and is_skipped = false;

create index if not exists idx_supply_items_status_machine
  on public.supply_items (status, machine_id);
