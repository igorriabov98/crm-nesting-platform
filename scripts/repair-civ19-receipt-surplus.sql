\set ON_ERROR_STOP on
-- Default: rehearse and ROLLBACK. Applying requires explicit psql variables:
-- -v apply=true -v actor_id=<operator UUID> -v backup_path=<absolute JSON path>
\if :{?apply}
\else
  \set apply false
\endif
\if :{?actor_id}
\else
  \echo 'actor_id is required'
  \quit 3
\endif
\if :apply
  \if :{?backup_path}
  \else
    \echo 'backup_path is required when apply=true'
    \quit 3
  \endif
\endif

BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT set_config('app.receipt_surplus_repair_actor', :'actor_id', true);
SELECT set_config('request.jwt.claim.sub', :'actor_id', true);
SELECT public.fn_try_lock_production_cutting_machine_v1('93766eaa-4656-4779-964c-de604f32c954');

-- Lock the exact evidence before either backing it up or repairing it.
SELECT id FROM public.supply_order_delivery_schedules
WHERE id IN ('61fb0dc1-8676-49be-be3e-41dba3874f65','e2491227-744f-4d8d-b30f-d747315966b6') ORDER BY id FOR UPDATE;
SELECT id FROM public.inventory WHERE id='c40b2464-1b4d-4fb8-88b8-db3d7bddb75d' FOR UPDATE;
SELECT id FROM public.production_fact_cutting_events WHERE id='b45e2e82-2f66-4bee-98ea-44fe6069aca6' FOR UPDATE;
SELECT id FROM public.inventory_reservations
WHERE id IN ('8f62d647-dea1-4234-b707-615165c9aadf','7dafd241-97e5-43ac-9595-af0981d33419') ORDER BY id FOR UPDATE;
SELECT id FROM public.production_fact_cutting_event_reservations
WHERE event_id='b45e2e82-2f66-4bee-98ea-44fe6069aca6'
AND request_item_id='4aa81ed9-3e2d-4df4-b43b-d158a84370e5' ORDER BY id FOR UPDATE;

DO $$
BEGIN
  IF NOT public.crm_user_is_admin(current_setting('app.receipt_surplus_repair_actor')::uuid)
    OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=current_setting('app.receipt_surplus_repair_actor')::uuid AND is_active) THEN
    RAISE EXCEPTION 'Active CRM administrator required';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.inventory_reservations'::regclass
    AND tgname='guard_supply_receipt_reservation_allocation' AND tgenabled='O') THEN
    RAISE EXCEPTION 'Deploy receipt surplus protection before restoring stock';
  END IF;
  IF EXISTS(SELECT 1 FROM public.inventory_transactions
    WHERE comment='Исправление CIV-19-2026: возврат 3 свободных листов после ошибочной автоброни [receipt-surplus:e2491227]') THEN
    IF EXISTS(SELECT 1 FROM public.inventory_reservations WHERE id='7dafd241-97e5-43ac-9595-af0981d33419')
      OR EXISTS(SELECT 1 FROM public.production_fact_cutting_event_reservations WHERE reservation_id='7dafd241-97e5-43ac-9595-af0981d33419') THEN
      RAISE EXCEPTION 'Repair marker exists but invalid reservation remains';
    END IF;
    PERFORM set_config('app.receipt_surplus_already_repaired','true',true);
    RETURN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.inventory WHERE id='c40b2464-1b4d-4fb8-88b8-db3d7bddb75d'
    AND material_id='8ce821e2-8ce0-49b9-bb58-42f358c16513' AND material_variant_id='311a191d-474b-4e1e-81fc-72ef4367c510'
    AND factory_id='14fc4014-3149-4127-b886-d56e30337763' AND total_quantity=0 AND reserved_quantity=0
    AND deleted_at IS NULL AND is_business_scrap=false AND piece_length_mm IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.request_sheet_metal WHERE id='4aa81ed9-3e2d-4df4-b43b-d158a84370e5'
      AND request_id='c7cc1c62-d902-4614-8675-fb21e74e95d4' AND remainder_qty=12 AND order_status='delivered')
    OR NOT EXISTS(SELECT 1 FROM public.production_fact_cutting_events WHERE id='b45e2e82-2f66-4bee-98ea-44fe6069aca6'
      AND machine_id='93766eaa-4656-4779-964c-de604f32c954' AND status='applied') THEN
    RAISE EXCEPTION 'Inventory, demand or cutting event changed; stop and re-audit';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.supply_order_delivery_schedules WHERE id='e2491227-744f-4d8d-b30f-d747315966b6'
    AND status='delivered' AND request_item_table='request_sheet_metal' AND request_item_id='4aa81ed9-3e2d-4df4-b43b-d158a84370e5'
    AND received_quantity=3 AND allocated_quantity=0 AND allocated_physical_quantity=0 AND excess_quantity=3
    AND receipt_inventory_id='c40b2464-1b4d-4fb8-88b8-db3d7bddb75d')
    OR NOT EXISTS(SELECT 1 FROM public.inventory_reservations WHERE id='7dafd241-97e5-43ac-9595-af0981d33419'
      AND supply_order_schedule_id='e2491227-744f-4d8d-b30f-d747315966b6' AND reserved_quantity=3
      AND inventory_id='c40b2464-1b4d-4fb8-88b8-db3d7bddb75d' AND machine_id='93766eaa-4656-4779-964c-de604f32c954'
      AND request_item_table='request_sheet_metal' AND request_item_id='4aa81ed9-3e2d-4df4-b43b-d158a84370e5'
      AND reservation_source='supply_receipt' AND consumed_at IS NOT NULL
      AND consumed_cutting_event_id='b45e2e82-2f66-4bee-98ea-44fe6069aca6'
      AND business_scrap_inventory_id IS NULL)
    OR (SELECT count(*) FROM public.production_fact_cutting_event_reservations
      WHERE reservation_id='7dafd241-97e5-43ac-9595-af0981d33419'
      AND event_id='b45e2e82-2f66-4bee-98ea-44fe6069aca6' AND reserved_quantity=3 AND consumed_quantity=3
      AND inventory_id='c40b2464-1b4d-4fb8-88b8-db3d7bddb75d' AND is_cut_reservation=false) <> 1
    OR NOT EXISTS(SELECT 1 FROM public.inventory_reservations WHERE id='8f62d647-dea1-4234-b707-615165c9aadf'
      AND reserved_quantity=12 AND consumed_at IS NOT NULL AND supply_order_schedule_id='61fb0dc1-8676-49be-be3e-41dba3874f65') THEN
    RAISE EXCEPTION 'Expected 12 allocated + 3 free receipt evidence changed';
  END IF;
  IF (SELECT count(*) FROM public.inventory_transactions WHERE inventory_id='c40b2464-1b4d-4fb8-88b8-db3d7bddb75d') <> 6
    OR NOT EXISTS(SELECT 1 FROM public.inventory_transactions WHERE id='e39166ef-de98-4654-81d8-e154ffcdf1cf'
      AND inventory_id='c40b2464-1b4d-4fb8-88b8-db3d7bddb75d' AND transaction_type='write_off' AND quantity=-3)
    OR (SELECT count(*) FROM public.inventory_reservations WHERE inventory_id='c40b2464-1b4d-4fb8-88b8-db3d7bddb75d') <> 2 THEN
    RAISE EXCEPTION 'Subsequent inventory operations exist; stop and re-audit';
  END IF;
END;
$$;

\pset format unaligned
\pset tuples_only on
\if :{?backup_path}
  \o :backup_path
\endif
SELECT jsonb_build_object(
  'captured_at',clock_timestamp(), 'actor',current_setting('app.receipt_surplus_repair_actor'),
  'inventory',(SELECT to_jsonb(i) FROM public.inventory i WHERE id='c40b2464-1b4d-4fb8-88b8-db3d7bddb75d'),
  'reservations',(SELECT jsonb_agg(to_jsonb(r)) FROM public.inventory_reservations r WHERE inventory_id='c40b2464-1b4d-4fb8-88b8-db3d7bddb75d'),
  'event_reservations',(SELECT jsonb_agg(to_jsonb(r)) FROM public.production_fact_cutting_event_reservations r WHERE inventory_id='c40b2464-1b4d-4fb8-88b8-db3d7bddb75d'),
  'transactions',(SELECT jsonb_agg(to_jsonb(t)) FROM public.inventory_transactions t WHERE inventory_id='c40b2464-1b4d-4fb8-88b8-db3d7bddb75d'),
  'schedules',(SELECT jsonb_agg(to_jsonb(s)) FROM public.supply_order_delivery_schedules s WHERE request_item_id='4aa81ed9-3e2d-4df4-b43b-d158a84370e5')
);
\o

DO $$
DECLARE v_actor uuid := current_setting('app.receipt_surplus_repair_actor')::uuid;
BEGIN
  IF current_setting('app.receipt_surplus_already_repaired',true)='true' THEN
    RAISE NOTICE 'Already repaired; no changes';
    RETURN;
  END IF;
  -- Keep all original movement history. Remove only the invalid operational
  -- reservation and its rollback snapshot, so a later cutting rollback cannot
  -- restore these same three sheets again. Both records are in the backup.
  DELETE FROM public.production_fact_cutting_event_reservations
  WHERE reservation_id='7dafd241-97e5-43ac-9595-af0981d33419';
  DELETE FROM public.inventory_reservations WHERE id='7dafd241-97e5-43ac-9595-af0981d33419';
  UPDATE public.inventory SET total_quantity=total_quantity+3,last_updated_by=v_actor,updated_at=now()
  WHERE id='c40b2464-1b4d-4fb8-88b8-db3d7bddb75d';
  INSERT INTO public.inventory_transactions(factory_id,inventory_id,material_id,material_variant_id,
    transaction_type,quantity,machine_id,request_item_table,request_item_id,performed_by,comment)
  VALUES('14fc4014-3149-4127-b886-d56e30337763','c40b2464-1b4d-4fb8-88b8-db3d7bddb75d',
    '8ce821e2-8ce0-49b9-bb58-42f358c16513','311a191d-474b-4e1e-81fc-72ef4367c510','adjustment',3,
    '93766eaa-4656-4779-964c-de604f32c954','request_sheet_metal','4aa81ed9-3e2d-4df4-b43b-d158a84370e5',v_actor,
    'Исправление CIV-19-2026: возврат 3 свободных листов после ошибочной автоброни [receipt-surplus:e2491227]');
  IF NOT EXISTS(SELECT 1 FROM public.inventory WHERE id='c40b2464-1b4d-4fb8-88b8-db3d7bddb75d'
    AND total_quantity=3 AND reserved_quantity=0 AND available_quantity=3) THEN
    RAISE EXCEPTION 'Repair postcondition failed';
  END IF;
END;
$$;
SELECT id,total_quantity,reserved_quantity,available_quantity FROM public.inventory
WHERE id='c40b2464-1b4d-4fb8-88b8-db3d7bddb75d';
\if :apply
  COMMIT;
\else
  ROLLBACK;
\endif
