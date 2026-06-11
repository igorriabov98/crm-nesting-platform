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
    WHERE mi.machine_id = m.id AND mi.coating = 'zinc'
  ) AS has_zinc,
  EXISTS(
    SELECT 1
    FROM public.machine_items mi
    WHERE mi.machine_id = m.id AND mi.coating = 'powder_coating'
  ) AS has_painting
FROM public.machines m;
