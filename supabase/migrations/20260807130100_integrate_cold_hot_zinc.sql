-- Both zinc coatings use the existing galvanizing route. The legacy `zinc`
-- enum value remains the stable storage key for hot-dip zinc.
CREATE OR REPLACE FUNCTION public.fn_sync_coating_dependent_production_stages(p_machine_id uuid)
RETURNS void AS $$
DECLARE
  v_has_zinc boolean;
  v_has_painting boolean;
BEGIN
  SELECT
    EXISTS (
      SELECT 1
      FROM public.machine_items
      WHERE machine_id = p_machine_id
        AND coating IN ('zinc', 'cold_zinc')
    ),
    EXISTS (
      SELECT 1
      FROM public.machine_items
      WHERE machine_id = p_machine_id
        AND coating = 'powder_coating'
    )
  INTO v_has_zinc, v_has_painting;

  UPDATE public.production_stages
  SET is_skipped = NOT v_has_zinc
  WHERE machine_id = p_machine_id
    AND stage_type IN ('galvanizing', 'post_galvanizing_cleaning');

  UPDATE public.production_stages
  SET is_skipped = NOT v_has_painting
  WHERE machine_id = p_machine_id
    AND stage_type = 'painting';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

UPDATE public.outsourcing_work_types
SET
  name = 'Цинкование',
  description = 'Холодное или горячее цинкование как внешний производственный этап',
  updated_at = now()
WHERE code = 'zinc' OR is_zinc = true;

-- `machines` gained packing columns after the previous view definition.
-- Recreate the view transactionally so `m.*` is refreshed together with the
-- new coating flags; CREATE OR REPLACE cannot insert those columns before the
-- existing computed columns.
DROP VIEW IF EXISTS public.machines_with_totals;

CREATE VIEW public.machines_with_totals AS
SELECT
  m.*,
  COALESCE(
    (SELECT SUM(mi.weight * mi.quantity) / 1000
     FROM public.machine_items mi
     WHERE mi.machine_id = m.id),
    0
  ) AS total_weight,
  COALESCE(
    (SELECT SUM(mi.price * mi.quantity)
     FROM public.machine_items mi
     WHERE mi.machine_id = m.id),
    0
  ) AS total_items_cost,
  COALESCE(
    (SELECT SUM(me.amount)
     FROM public.machine_expenses me
     WHERE me.machine_id = m.id),
    0
  ) AS total_expenses,
  COALESCE(
    (SELECT SUM(mi.price * mi.quantity)
     FROM public.machine_items mi
     WHERE mi.machine_id = m.id),
    0
  ) + COALESCE(
    (SELECT SUM(me.amount)
     FROM public.machine_expenses me
     WHERE me.machine_id = m.id),
    0
  ) AS total_cost,
  COALESCE(
    (SELECT COUNT(mi.id)
     FROM public.machine_items mi
     WHERE mi.machine_id = m.id),
    0
  ) AS item_count,
  EXISTS(
    SELECT 1
    FROM public.machine_items mi
    WHERE mi.machine_id = m.id
      AND mi.coating IN ('zinc', 'cold_zinc')
  ) AS has_zinc,
  EXISTS(
    SELECT 1
    FROM public.machine_items mi
    WHERE mi.machine_id = m.id
      AND mi.coating = 'powder_coating'
  ) AS has_painting,
  EXISTS(
    SELECT 1
    FROM public.machine_items mi
    WHERE mi.machine_id = m.id
      AND mi.coating = 'zinc'
  ) AS has_hot_zinc,
  EXISTS(
    SELECT 1
    FROM public.machine_items mi
    WHERE mi.machine_id = m.id
      AND mi.coating = 'cold_zinc'
  ) AS has_cold_zinc
FROM public.machines m;

SELECT public.fn_sync_coating_dependent_production_stages(id)
FROM public.machines;
