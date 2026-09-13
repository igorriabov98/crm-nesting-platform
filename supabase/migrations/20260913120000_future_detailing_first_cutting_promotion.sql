-- A first "Заготовка" fact makes the complete future-detailing plan available
-- in the regular detailing warehouse. The promotion is atomic and idempotent:
-- only planned/awaiting items are accepted, and the batch is locked first.

create or replace function public.fn_promote_future_detailing_batch_on_cutting_event_v1(
  p_batch_id uuid,
  p_event_id uuid,
  p_actor uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch public.future_detailing_batches%rowtype;
  v_event public.production_fact_cutting_events%rowtype;
  v_item public.future_detailing_items%rowtype;
  v_actor uuid;
  v_on_hand integer;
  v_reserved integer;
  v_promoted integer := 0;
begin
  select * into v_batch
  from public.future_detailing_batches
  where id = p_batch_id
  for update;

  if not found or v_batch.status not in ('planned', 'awaiting_confirmation') then
    return 0;
  end if;

  select * into v_event
  from public.production_fact_cutting_events
  where id = p_event_id
    and machine_id = v_batch.machine_id
    and status in ('applied', 'kept');

  if not found then
    raise exception 'Факт заготовки не найден или не относится к машине плана';
  end if;

  v_actor := coalesce(p_actor, v_event.created_by, v_batch.created_by);

  for v_item in
    select *
    from public.future_detailing_items
    where batch_id = v_batch.id
      and status in ('planned', 'awaiting_confirmation')
    order by created_at, id
    for update
  loop
    insert into public.detailing_balances(
      part_id,
      factory_id,
      on_hand_quantity,
      reserved_quantity,
      updated_by
    ) values (
      v_item.part_id,
      v_batch.factory_id,
      v_item.planned_quantity,
      0,
      v_actor
    )
    on conflict(part_id, factory_id) do update
    set on_hand_quantity = public.detailing_balances.on_hand_quantity + excluded.on_hand_quantity,
        updated_by = excluded.updated_by,
        updated_at = now()
    returning on_hand_quantity, reserved_quantity into v_on_hand, v_reserved;

    insert into public.detailing_movements(
      part_id,
      factory_id,
      movement_type,
      quantity_delta,
      reserved_delta,
      on_hand_after,
      reserved_after,
      machine_id,
      production_fact_id,
      performed_by,
      comment
    ) values (
      v_item.part_id,
      v_batch.factory_id,
      'receipt',
      v_item.planned_quantity,
      0,
      v_on_hand,
      v_reserved,
      v_batch.machine_id,
      v_event.fact_id,
      v_actor,
      'Автоматическое поступление будущей деталировки по первому факту заготовки'
    );

    update public.future_detailing_items
    set actual_quantity = planned_quantity,
        status = 'confirmed',
        variance_reason = null,
        updated_at = now()
    where id = v_item.id;

    v_promoted := v_promoted + 1;
  end loop;

  update public.future_detailing_batches
  set status = 'confirmed',
      first_cutting_event_id = v_event.id,
      confirmation_due_date = null,
      confirmed_at = coalesce(confirmed_at, now()),
      updated_at = now()
  where id = v_batch.id;

  update public.tasks
  set status = 'completed',
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where id = v_batch.confirmation_task_id
    and status in ('pending', 'in_progress');

  return v_promoted;
end;
$$;

revoke all on function public.fn_promote_future_detailing_batch_on_cutting_event_v1(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.fn_promote_future_detailing_batch_on_cutting_event_v1(uuid, uuid, uuid)
to service_role;

create or replace function public.future_detailing_on_cutting_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch_id uuid;
begin
  for v_batch_id in
    select batch.id
    from public.future_detailing_batches batch
    where batch.machine_id = new.machine_id
      and batch.status in ('planned', 'awaiting_confirmation')
    order by batch.created_at, batch.id
  loop
    perform public.fn_promote_future_detailing_batch_on_cutting_event_v1(
      v_batch_id,
      new.id,
      new.created_by
    );
  end loop;

  return new;
end;
$$;

revoke all on function public.future_detailing_on_cutting_event()
from public, anon, authenticated;

-- Reconcile only the legacy batches that the old trigger already attached to a
-- cutting event. A merely planned batch may have been created after an older
-- event on the same machine and must wait for its own first subsequent fact.
do $$
declare
  v_row record;
begin
  for v_row in
    select
      batch.id as batch_id,
      event.id as event_id,
      coalesce(event.created_by, batch.created_by) as actor_id
    from public.future_detailing_batches batch
    join public.production_fact_cutting_events event
      on event.id = batch.first_cutting_event_id
     and event.machine_id = batch.machine_id
     and event.status in ('applied', 'kept')
    where batch.status = 'awaiting_confirmation'
    order by batch.created_at, batch.id
  loop
    perform public.fn_promote_future_detailing_batch_on_cutting_event_v1(
      v_row.batch_id,
      v_row.event_id,
      v_row.actor_id
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
