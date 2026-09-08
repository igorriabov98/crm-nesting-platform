ALTER TABLE public.transport_trip_need_links
  ADD COLUMN IF NOT EXISTS cargo_snapshot jsonb;

ALTER TABLE public.transport_trip_need_links
  DROP CONSTRAINT IF EXISTS transport_trip_need_links_cargo_snapshot_v1_check,
  ADD CONSTRAINT transport_trip_need_links_cargo_snapshot_v1_check CHECK (
    cargo_snapshot IS NULL
    OR (
      jsonb_typeof(cargo_snapshot) = 'object'
      AND cargo_snapshot->>'version' = '1'
      AND jsonb_typeof(cargo_snapshot->'itemLabels') = 'array'
      AND jsonb_typeof(cargo_snapshot->'itemDetails') = 'array'
    )
  );

COMMENT ON COLUMN public.transport_trip_need_links.cargo_snapshot IS
  'Versioned display-only cargo composition captured atomically when a trip is created or edited';

ALTER FUNCTION public.fn_create_transport_trip_v3(
  uuid, date, numeric, text, jsonb, jsonb, text, uuid
) RENAME TO fn_create_transport_trip_v3_before_cargo_snapshot;

REVOKE ALL ON FUNCTION public.fn_create_transport_trip_v3_before_cargo_snapshot(
  uuid, date, numeric, text, jsonb, jsonb, text, uuid
) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.fn_create_transport_trip_v3(
  p_carrier_supplier_id uuid,
  p_scheduled_date date,
  p_price numeric,
  p_comment text,
  p_stops jsonb,
  p_links jsonb,
  p_date_change_reason text,
  p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_trip_id uuid;
BEGIN
  v_trip_id := public.fn_create_transport_trip_v3_before_cargo_snapshot(
    p_carrier_supplier_id,
    p_scheduled_date,
    p_price,
    p_comment,
    p_stops,
    p_links,
    p_date_change_reason,
    p_actor
  );

  UPDATE public.transport_trip_need_links AS link
  SET cargo_snapshot = NULLIF(desired.value->'cargoSnapshot', 'null'::jsonb)
  FROM jsonb_array_elements(p_links) AS desired(value)
  WHERE link.transport_order_id = v_trip_id
    AND link.released_at IS NULL
    AND link.need_source = desired.value->>'needSource'
    AND link.need_id = (desired.value->>'needId')::uuid;

  RETURN v_trip_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_transport_trip_v3(
  uuid, date, numeric, text, jsonb, jsonb, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_transport_trip_v3(
  uuid, date, numeric, text, jsonb, jsonb, text, uuid
) TO service_role;

ALTER FUNCTION public.fn_update_transport_trip_v4(
  uuid, uuid, date, numeric, text, jsonb, jsonb, text, text, uuid
) RENAME TO fn_update_transport_trip_v4_before_cargo_snapshot;

REVOKE ALL ON FUNCTION public.fn_update_transport_trip_v4_before_cargo_snapshot(
  uuid, uuid, date, numeric, text, jsonb, jsonb, text, text, uuid
) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.fn_update_transport_trip_v4(
  p_trip_id uuid,
  p_carrier_supplier_id uuid,
  p_scheduled_date date,
  p_price numeric,
  p_comment text,
  p_stops jsonb,
  p_links jsonb,
  p_remove_reason text,
  p_date_change_reason text,
  p_actor uuid
) RETURNS public.outsourcing_transport_order_status
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_status public.outsourcing_transport_order_status;
BEGIN
  v_status := public.fn_update_transport_trip_v4_before_cargo_snapshot(
    p_trip_id,
    p_carrier_supplier_id,
    p_scheduled_date,
    p_price,
    p_comment,
    p_stops,
    p_links,
    p_remove_reason,
    p_date_change_reason,
    p_actor
  );

  UPDATE public.transport_trip_need_links AS link
  SET cargo_snapshot = NULLIF(desired.value->'cargoSnapshot', 'null'::jsonb)
  FROM jsonb_array_elements(p_links) AS desired(value)
  WHERE link.transport_order_id = p_trip_id
    AND link.released_at IS NULL
    AND link.need_source = desired.value->>'needSource'
    AND link.need_id = (desired.value->>'needId')::uuid;

  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_update_transport_trip_v4(
  uuid, uuid, date, numeric, text, jsonb, jsonb, text, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_transport_trip_v4(
  uuid, uuid, date, numeric, text, jsonb, jsonb, text, text, uuid
) TO service_role;
