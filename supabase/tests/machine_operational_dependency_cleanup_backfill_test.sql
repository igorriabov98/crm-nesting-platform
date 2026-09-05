BEGIN;

INSERT INTO public.factories(id, name, city)
VALUES (
  'b1000000-0000-0000-0000-000000000001',
  'Cleanup backfill factory',
  'Cleanup backfill city'
);

INSERT INTO public.users(id, email, full_name, role, factory_id)
VALUES (
  'b2000000-0000-0000-0000-000000000001',
  'cleanup-backfill@example.test',
  'Cleanup Backfill Director',
  'planning_director',
  'b1000000-0000-0000-0000-000000000001'
);

INSERT INTO public.machines(
  id, name, created_by, factory_id, production_month,
  production_workshop, production_queue_number,
  is_archived, archived_at, archived_by, archive_reason
) VALUES (
  'b3000000-0000-0000-0000-000000000001',
  'Already archived cleanup order',
  'b2000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001',
  '2026-09-01',
  1,
  1,
  true,
  '2026-09-04 12:00:00+00',
  'b2000000-0000-0000-0000-000000000001',
  'Archived before cleanup migration'
);

INSERT INTO public.technologist_requests(id, machine_id, created_by, status)
VALUES (
  'b4000000-0000-0000-0000-000000000001',
  'b3000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000001',
  'submitted_to_supply'
);

INSERT INTO public.materials(id, name, category, created_by)
VALUES (
  'b5000000-0000-0000-0000-000000000001',
  'Cleanup backfill pipe',
  'pipe',
  'b2000000-0000-0000-0000-000000000001'
);

INSERT INTO public.material_variants(
  id, material_id, category, pipe_type, width_mm, height_mm,
  wall_thickness_mm, standard_length_mm, weight_per_m_kg, default_unit
) VALUES (
  'b5000000-0000-0000-0000-000000000002',
  'b5000000-0000-0000-0000-000000000001',
  'pipe', 'square', 40, 40, 10, 12000, 10, 'мм'
);

INSERT INTO public.request_pipe(
  id, request_id, pipe_type, size, wall_thickness_mm,
  remainder_length_mm, remainder_qty, remainder_kg,
  material_id, material_variant_id,
  reserved_from_stock_length_mm, reserved_from_stock_qty,
  reserved_from_stock_kg, order_status
) VALUES (
  'b6000000-0000-0000-0000-000000000001',
  'b4000000-0000-0000-0000-000000000001',
  'square', '40x40', 10, 12000, 1, 120,
  'b5000000-0000-0000-0000-000000000001',
  'b5000000-0000-0000-0000-000000000002',
  12000, 1, 120, 'pending'
);

INSERT INTO public.inventory(
  id, factory_id, material_id, material_variant_id,
  total_quantity, reserved_quantity, unit,
  total_secondary_quantity, reserved_secondary_quantity,
  secondary_unit, piece_length_mm, last_updated_by
) VALUES (
  'b7000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001',
  'b5000000-0000-0000-0000-000000000001',
  'b5000000-0000-0000-0000-000000000002',
  12000, 12000, 'мм', 1, 1, 'шт', 12000,
  'b2000000-0000-0000-0000-000000000001'
);

INSERT INTO public.inventory(
  id, factory_id, material_id, material_variant_id,
  total_quantity, reserved_quantity, unit,
  total_secondary_quantity, reserved_secondary_quantity,
  secondary_unit, piece_length_mm, is_business_scrap,
  business_scrap_state, source_machine_id, last_updated_by
) VALUES (
  'b7000000-0000-0000-0000-000000000002',
  'b1000000-0000-0000-0000-000000000001',
  'b5000000-0000-0000-0000-000000000001',
  'b5000000-0000-0000-0000-000000000002',
  4688, 0, 'мм', 1, 0, 'шт', 4688, true, 'future',
  'b3000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000001'
);

INSERT INTO public.inventory_reservations(
  id, inventory_id, source_inventory_id,
  material_id, material_variant_id, machine_id,
  request_item_table, request_item_id,
  reserved_quantity, reserved_secondary_quantity,
  reserved_by, reservation_source
) VALUES (
  'b8000000-0000-0000-0000-000000000001',
  'b7000000-0000-0000-0000-000000000001',
  'b7000000-0000-0000-0000-000000000001',
  'b5000000-0000-0000-0000-000000000001',
  'b5000000-0000-0000-0000-000000000002',
  'b3000000-0000-0000-0000-000000000001',
  'request_pipe',
  'b6000000-0000-0000-0000-000000000001',
  12000, 1,
  'b2000000-0000-0000-0000-000000000001',
  'stock'
);

-- Reproduce a legacy partial archive: the request was already cancelled while
-- its reservation and companion reservation fields remained active.
UPDATE public.request_pipe
SET order_status = 'cancelled',
    cancelled_at = '2026-09-04 12:01:00+00',
    cancelled_by = 'b2000000-0000-0000-0000-000000000001',
    cancellation_reason = 'Legacy partial archive'
WHERE id = 'b6000000-0000-0000-0000-000000000001';

COMMIT;

\ir ../migrations/20260905140000_machine_operational_dependency_cleanup.sql

DO $assertions$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.inventory_reservations
    WHERE machine_id = 'b3000000-0000-0000-0000-000000000001'
      AND consumed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'backfill left an active inventory reservation';
  END IF;

  IF (SELECT reserved_quantity FROM public.inventory
      WHERE id = 'b7000000-0000-0000-0000-000000000001') <> 0
     OR (SELECT available_quantity FROM public.inventory
         WHERE id = 'b7000000-0000-0000-0000-000000000001') <> 12000 THEN
    RAISE EXCEPTION 'backfill did not restore physical stock';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory
    WHERE id = 'b7000000-0000-0000-0000-000000000002'
      AND (deleted_at IS NULL OR total_quantity <> 0 OR reserved_quantity <> 0)
  ) THEN
    RAISE EXCEPTION 'backfill did not remove future business scrap';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.request_pipe
    WHERE id = 'b6000000-0000-0000-0000-000000000001'
      AND (
        reserved_from_stock_length_mm <> 0
        OR reserved_from_stock_qty <> 0
        OR reserved_from_stock_kg <> 0
        OR order_status <> 'cancelled'
      )
  ) THEN
    RAISE EXCEPTION 'backfill did not synchronize archived supply request state';
  END IF;
END;
$assertions$;
