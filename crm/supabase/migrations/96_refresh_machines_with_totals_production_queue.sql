drop view if exists public.machines_with_totals;

create view public.machines_with_totals as
select
  m.*,
  coalesce(
    (select sum(mi.weight * mi.quantity) / 1000
     from public.machine_items mi
     where mi.machine_id = m.id),
    0
  ) as total_weight,
  coalesce(
    (select sum(mi.price * mi.quantity)
     from public.machine_items mi
     where mi.machine_id = m.id),
    0
  ) as total_items_cost,
  coalesce(
    (select sum(me.amount)
     from public.machine_expenses me
     where me.machine_id = m.id),
    0
  ) as total_expenses,
  coalesce(
    (select sum(mi.price * mi.quantity)
     from public.machine_items mi
     where mi.machine_id = m.id),
    0
  ) + coalesce(
    (select sum(me.amount)
     from public.machine_expenses me
     where me.machine_id = m.id),
    0
  ) as total_cost,
  coalesce(
    (select count(mi.id)
     from public.machine_items mi
     where mi.machine_id = m.id),
    0
  ) as item_count,
  exists(
    select 1
    from public.machine_items mi
    where mi.machine_id = m.id and mi.coating = 'zinc'
  ) as has_zinc,
  exists(
    select 1
    from public.machine_items mi
    where mi.machine_id = m.id and mi.coating = 'powder_coating'
  ) as has_painting
from public.machines m;
