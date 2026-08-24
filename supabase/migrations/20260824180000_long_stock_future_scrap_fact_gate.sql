-- A calculated remnant from an approved long-stock cutting plan is only a
-- forecast. It becomes available when the corresponding physical bar is
-- recorded in the cutting fact, not when the planned stage date arrives.

create or replace function public.fn_promote_due_future_business_scrap(
  p_today date default current_date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  with promoted as (
    update public.inventory as inventory
    set business_scrap_state = 'available',
        updated_at = now()
    from public.production_stages as stage
    where inventory.is_business_scrap = true
      and inventory.business_scrap_state = 'future'
      and inventory.deleted_at is null
      and inventory.available_from_stage_id = stage.id
      and stage.stage_type = 'cutting'::public.stage_type
      and stage.date_start is not null
      and stage.date_start <= p_today
      and not exists (
        select 1
        from public.long_stock_cutting_business_scraps as plan_scrap
        where plan_scrap.inventory_id = inventory.id
      )
      and (
        inventory.source_reservation_id is null
        or exists (
          select 1
          from public.inventory_reservations as reservation
          where reservation.id = inventory.source_reservation_id
            and reservation.consumed_at is not null
        )
      )
    returning inventory.id
  )
  select count(*) into v_count from promoted;

  return v_count;
end;
$$;

revoke all on function public.fn_promote_due_future_business_scrap(date)
  from public, anon, authenticated;
grant execute on function public.fn_promote_due_future_business_scrap(date)
  to service_role;

-- Repair only untouched plan remnants that the former date-based promotion
-- moved early. Rows already used by a fact or an active reservation are left
-- unchanged for an operator-visible reconciliation instead of rewriting facts.
update public.inventory as inventory
set business_scrap_state = 'future',
    updated_at = now()
from public.long_stock_cutting_business_scraps as plan_scrap
join public.long_stock_cutting_candidate_bars as bar
  on bar.version_id = plan_scrap.version_id
 and bar.id = plan_scrap.bar_id
where inventory.id = plan_scrap.inventory_id
  and inventory.is_business_scrap = true
  and inventory.business_scrap_state = 'available'
  and inventory.deleted_at is null
  and bar.status = 'planned'
  and coalesce(inventory.reserved_quantity, 0) = 0
  and coalesce(inventory.reserved_secondary_quantity, 0) = 0
  and not exists (
    select 1
    from public.long_stock_cutting_fact_bars as fact_bar
    where fact_bar.result_inventory_id = inventory.id
      and fact_bar.rolled_back_at is null
  )
  and not exists (
    select 1
    from public.inventory_reservations as reservation
    where reservation.consumed_at is null
      and (
        reservation.inventory_id = inventory.id
        or reservation.source_inventory_id = inventory.id
      )
  );
