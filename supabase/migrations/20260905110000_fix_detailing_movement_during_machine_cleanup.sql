-- A machine row is already absent while its machine_items are removed by the
-- cascading foreign key. Reservation cleanup still needs to write an audit
-- movement, but retaining that deleted machine id would violate the movement
-- foreign key. This mirrors detailing_movements.machine_id ON DELETE SET NULL
-- for movements created during the same cascading delete.
CREATE OR REPLACE FUNCTION public.detailing_record_movement(
  p_part_id uuid,
  p_factory_id uuid,
  p_type public.detailing_movement_type,
  p_quantity_delta integer,
  p_reserved_delta integer,
  p_actor uuid,
  p_machine_id uuid DEFAULT NULL,
  p_reservation_id uuid DEFAULT NULL,
  p_transfer_id uuid DEFAULT NULL,
  p_production_fact_id uuid DEFAULT NULL,
  p_comment text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance public.detailing_balances%ROWTYPE;
  v_id uuid;
  v_existing_machine_id uuid;
BEGIN
  SELECT * INTO v_balance
  FROM public.detailing_balances
  WHERE part_id = p_part_id AND factory_id = p_factory_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Остаток деталировки не найден';
  END IF;

  SELECT machine.id INTO v_existing_machine_id
  FROM public.machines machine
  WHERE machine.id = p_machine_id;

  INSERT INTO public.detailing_movements (
    part_id, factory_id, movement_type, quantity_delta, reserved_delta,
    on_hand_after, reserved_after, machine_id, reservation_id, transfer_id,
    production_fact_id, performed_by, comment
  ) VALUES (
    p_part_id, p_factory_id, p_type, p_quantity_delta, p_reserved_delta,
    v_balance.on_hand_quantity, v_balance.reserved_quantity, v_existing_machine_id,
    p_reservation_id, p_transfer_id, p_production_fact_id, p_actor, NULLIF(btrim(p_comment), '')
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.detailing_record_movement(
  uuid, uuid, public.detailing_movement_type, integer, integer, uuid,
  uuid, uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
