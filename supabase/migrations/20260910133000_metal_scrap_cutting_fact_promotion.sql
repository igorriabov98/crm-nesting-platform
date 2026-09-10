-- Promote completion-sourced metal scrap when a cutting fact is recorded.
-- The production fact is the same warehouse boundary that consumes the
-- material reservation, so the future scrap must become available in that
-- transaction as well.  The triggers below also cover a completion entered
-- after the fact was recorded.

alter table public.metal_scrap_movements
  drop constraint if exists metal_scrap_movements_movement_type_check;

alter table public.metal_scrap_movements
  add constraint metal_scrap_movements_movement_type_check
  check (movement_type in (
    'planned', 'available', 'correction', 'blocked', 'reviewed',
    'sale', 'sale_cancelled', 'inventory_conversion', 'future_rollback'
  ));

create table if not exists public.production_fact_cutting_event_metal_scrap_promotions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.production_fact_cutting_events(id) on delete cascade,
  lot_id uuid not null references public.metal_scrap_lots(id) on delete restrict,
  previous_status text not null check (previous_status = 'future'),
  previous_available_weight_kg numeric(14,3) not null check (previous_available_weight_kg >= 0),
  previous_blocked_weight_kg numeric(14,3) not null check (previous_blocked_weight_kg >= 0),
  previous_promoted_stage_end date,
  created_at timestamptz not null default now(),
  unique (event_id, lot_id)
);

create index if not exists production_fact_cutting_event_metal_scrap_promotions_lot_idx
  on public.production_fact_cutting_event_metal_scrap_promotions(lot_id, created_at desc);

revoke all on table public.production_fact_cutting_event_metal_scrap_promotions
  from public, anon, authenticated;

create or replace function public.fn_promote_metal_scrap_for_cutting_event_v1(
  p_event_id uuid,
  p_performed_by uuid,
  p_lot_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event record;
  v_lot public.metal_scrap_lots%rowtype;
  v_promotion_id uuid;
  v_available numeric;
  v_actor uuid;
  v_promoted integer := 0;
begin
  if p_event_id is null then
    raise exception 'Не указано событие продвижения металлолома';
  end if;

  select event.id, event.machine_id, event.fact_date, event.status
  into v_event
  from public.production_fact_cutting_events event
  where event.id = p_event_id
  for update;

  if not found or v_event.status is distinct from 'applied' then
    raise exception 'Событие заготовки недоступно для продвижения металлолома';
  end if;

  for v_lot in
    select lot.*
    from public.metal_scrap_lots lot
    where lot.machine_id = v_event.machine_id
      and lot.source_type = 'request_completion'
      and lot.status = 'future'
      and (p_lot_id is null or lot.id = p_lot_id)
    order by lot.created_at, lot.id
    for update
  loop
    v_promotion_id := null;
    insert into public.production_fact_cutting_event_metal_scrap_promotions(
      event_id,
      lot_id,
      previous_status,
      previous_available_weight_kg,
      previous_blocked_weight_kg,
      previous_promoted_stage_end
    ) values (
      v_event.id,
      v_lot.id,
      v_lot.status,
      v_lot.available_weight_kg,
      v_lot.blocked_weight_kg,
      v_lot.promoted_stage_end
    )
    on conflict (event_id, lot_id) do nothing
    returning id into v_promotion_id;

    if v_promotion_id is null then
      continue;
    end if;

    v_available := greatest(v_lot.expected_weight_kg - v_lot.sold_weight_kg, 0);
    v_actor := coalesce(p_performed_by, v_lot.created_by);
    if v_actor is null then
      raise exception 'Не указан автор продвижения металлолома';
    end if;

    update public.metal_scrap_lots
    set status = 'available',
        available_weight_kg = v_available,
        blocked_weight_kg = 0,
        promoted_stage_end = null,
        updated_at = now()
    where id = v_lot.id
      and status = 'future';

    insert into public.metal_scrap_movements(
      lot_id,
      movement_type,
      weight_delta_kg,
      available_after_kg,
      blocked_after_kg,
      sold_after_kg,
      reason,
      performed_by
    ) values (
      v_lot.id,
      'available',
      v_available - v_lot.available_weight_kg,
      v_available,
      0,
      v_lot.sold_weight_kg,
      'Металлолом переведен из будущего по факту заготовки',
      v_actor
    );

    v_promoted := v_promoted + 1;
  end loop;

  return v_promoted;
end;
$$;

revoke all on function public.fn_promote_metal_scrap_for_cutting_event_v1(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_promote_metal_scrap_for_cutting_event_v1(uuid, uuid, uuid)
  to service_role;

create or replace function public.metal_scrap_on_cutting_fact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'applied'
    and (tg_op = 'INSERT' or old.status is distinct from 'applied') then
    perform public.fn_promote_metal_scrap_for_cutting_event_v1(
      new.id,
      new.created_by
    );
  end if;
  return new;
end;
$$;

drop trigger if exists metal_scrap_cutting_fact on public.production_fact_cutting_events;
create trigger metal_scrap_cutting_fact
  after insert or update of status on public.production_fact_cutting_events
  for each row execute function public.metal_scrap_on_cutting_fact();

create or replace function public.metal_scrap_on_planned_movement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lot public.metal_scrap_lots%rowtype;
  v_event_id uuid;
  v_event_actor uuid;
begin
  if new.movement_type <> 'planned' then
    return new;
  end if;

  select lot.*
  into v_lot
  from public.metal_scrap_lots lot
  where lot.id = new.lot_id;

  if not found
    or v_lot.source_type <> 'request_completion'
    or v_lot.machine_id is null
    or v_lot.status is distinct from 'future' then
    return new;
  end if;

  -- Serialize a completion entered while a cutting fact is being applied.
  -- Whichever transaction gets the machine lock second sees the committed
  -- event/lot and performs the missing promotion.
  perform public.fn_lock_production_cutting_machine_v1(v_lot.machine_id);

  select lot.*
  into v_lot
  from public.metal_scrap_lots lot
  where lot.id = new.lot_id
    and lot.status = 'future'
  for update;

  if not found then
    return new;
  end if;

  select event.id, event.created_by
  into v_event_id, v_event_actor
  from public.production_fact_cutting_events event
  where event.machine_id = v_lot.machine_id
    and event.status = 'applied'
  order by event.created_at, event.id
  limit 1;

  if v_event_id is not null then
    perform public.fn_promote_metal_scrap_for_cutting_event_v1(
      v_event_id,
      coalesce(new.performed_by, v_event_actor),
      new.lot_id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists metal_scrap_lot_cutting_fact on public.metal_scrap_lots;
drop trigger if exists metal_scrap_planned_movement_cutting_fact on public.metal_scrap_movements;
create trigger metal_scrap_planned_movement_cutting_fact
  after insert on public.metal_scrap_movements
  for each row execute function public.metal_scrap_on_planned_movement();

-- The rollback review is the explicit inverse of the cutting fact. Restore
-- only lots this event promoted, and refuse an unsafe rollback after sale or
-- manual review has changed the lot's ownership.
alter function public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text)
  rename to fn_apply_production_cutting_rollback_before_metal_scrap_v1;

revoke all on function public.fn_apply_production_cutting_rollback_before_metal_scrap_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.fn_apply_production_cutting_rollback(
  p_machine_id uuid,
  p_task_id uuid,
  p_performed_by uuid,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_ids uuid[];
  v_result jsonb;
  v_restored integer := 0;
  v_lot record;
begin
  perform public.fn_lock_production_cutting_machine_v1(p_machine_id);

  select coalesce(array_agg(locked_event.id order by locked_event.created_at, locked_event.id), '{}'::uuid[])
  into v_event_ids
  from (
    select event.id, event.created_at
    from public.production_fact_cutting_events event
    where event.machine_id = p_machine_id
      and event.status = 'applied'
    order by event.created_at, event.id
    for update
  ) locked_event;

  perform set_config(
    'app.production_cutting_rollback_event_ids',
    v_event_ids::text,
    true
  );

  if exists (
    select 1
    from public.production_fact_cutting_event_metal_scrap_promotions promotion
    join public.metal_scrap_lots lot on lot.id = promotion.lot_id
    where promotion.event_id = any(v_event_ids)
      and (
        lot.sold_weight_kg > 0
        or lot.status = 'review_required'
        or lot.blocked_weight_kg > 0
      )
  ) then
    raise exception 'Откат заготовки заблокирован: металлолом уже продан или находится на перепроверке';
  end if;

  v_result := public.fn_apply_production_cutting_rollback_before_metal_scrap_v1(
    p_machine_id,
    p_task_id,
    p_performed_by,
    p_comment
  );

  for v_lot in
    select
      lot.id,
      lot.available_weight_kg as current_available_weight_kg,
      lot.sold_weight_kg as current_sold_weight_kg,
      lot.blocked_weight_kg as current_blocked_weight_kg,
      promotion.previous_status,
      promotion.previous_available_weight_kg,
      promotion.previous_blocked_weight_kg,
      promotion.previous_promoted_stage_end
    from public.metal_scrap_lots lot
    join public.production_fact_cutting_event_metal_scrap_promotions promotion
      on promotion.lot_id = lot.id
    where promotion.event_id = any(v_event_ids)
      and lot.status = 'available'
      and lot.sold_weight_kg = 0
      and lot.blocked_weight_kg = 0
    order by lot.id
    for update of lot
  loop
    update public.metal_scrap_lots
    set status = v_lot.previous_status,
        available_weight_kg = v_lot.previous_available_weight_kg,
        blocked_weight_kg = v_lot.previous_blocked_weight_kg,
        promoted_stage_end = v_lot.previous_promoted_stage_end,
        updated_at = now()
    where id = v_lot.id;

    insert into public.metal_scrap_movements(
      lot_id,
      movement_type,
      weight_delta_kg,
      available_after_kg,
      blocked_after_kg,
      sold_after_kg,
      reason,
      performed_by
    ) values (
      v_lot.id,
      'future_rollback',
      -v_lot.current_available_weight_kg,
      v_lot.previous_available_weight_kg,
      v_lot.previous_blocked_weight_kg,
      v_lot.current_sold_weight_kg,
      coalesce(nullif(p_comment, ''), 'Откат факта заготовки'),
      p_performed_by
    );
    v_restored := v_restored + 1;
  end loop;

  perform set_config('app.production_cutting_rollback_event_ids', '', true);

  return v_result || jsonb_build_object(
    'metalScrap', jsonb_build_object('restoredLots', v_restored)
  );
end;
$$;

revoke all on function public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text)
  to service_role;

comment on function public.fn_promote_metal_scrap_for_cutting_event_v1(uuid, uuid, uuid) is
  'Promotes request-completion metal scrap to available in the cutting-fact transaction.';
comment on function public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text) is
  'Rolls back cutting consequences and restores metal scrap promoted by those facts.';

notify pgrst, 'reload schema';
