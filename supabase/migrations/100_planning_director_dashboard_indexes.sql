-- Prepared for the planning director dashboard.
-- This migration is intentionally not applied automatically.

CREATE INDEX IF NOT EXISTS idx_machines_overdue_shipping_dashboard
  ON machines(factory_id, desired_shipping_date)
  WHERE is_confirmed = true
    AND is_archived = false
    AND actual_shipping_date IS NULL
    AND desired_shipping_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_personal_active_dashboard
  ON tasks(assigned_to, deadline, created_at)
  WHERE status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_department_requests_personal_active_dashboard
  ON department_requests(assigned_to, due_date, created_at)
  WHERE status IN ('new', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_supply_schedules_open_date_dashboard
  ON supply_order_delivery_schedules(delivery_date, request_item_table, request_item_id)
  WHERE status = 'planned';

CREATE INDEX IF NOT EXISTS idx_supply_items_open_date_dashboard
  ON supply_items(machine_id, planned_delivery_date)
  WHERE status IN ('not_ordered', 'ordered');

CREATE INDEX IF NOT EXISTS idx_consumable_requests_risk_dashboard
  ON consumable_requests(factory_id, need_by_date)
  WHERE status IN ('new', 'invoice_taken', 'delivery', 'received_partial');

CREATE INDEX IF NOT EXISTS idx_detailing_transfers_risk_dashboard
  ON detailing_transfers(destination_factory_id, expected_arrival_date)
  WHERE status IN ('needs_date', 'scheduled', 'partially_received');

CREATE INDEX IF NOT EXISTS idx_inventory_transfers_risk_dashboard
  ON inventory_transfers(destination_factory_id, expected_arrival_date)
  WHERE status IN ('needs_date', 'scheduled', 'partially_received');

CREATE INDEX IF NOT EXISTS idx_outsourcing_returns_risk_dashboard
  ON machine_outsourcing_operations(planned_return_date, machine_id)
  WHERE archived_at IS NULL AND actual_returned_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_outsourcing_transport_risk_dashboard
  ON machine_outsourcing_transport_needs(needed_date, operation_id)
  WHERE status IN ('open', 'linked');
