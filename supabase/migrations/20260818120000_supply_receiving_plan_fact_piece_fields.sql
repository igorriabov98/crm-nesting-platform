-- Split the ordered bar composition from the physical composition accepted at
-- receiving. This follows the existing schedule date lifecycle: delivery_date
-- remains the plan, while delivered_at / received_by and received_* are facts.

alter table public.supply_order_delivery_schedules
  add column planned_piece_length_mm numeric,
  add column planned_piece_count numeric;

alter table public.supply_order_delivery_schedules
  drop constraint if exists supply_order_delivery_schedules_piece_values_check;

alter table public.supply_order_delivery_schedules
  add constraint supply_order_delivery_schedules_piece_values_check
  check (
    (planned_piece_length_mm is null or planned_piece_length_mm > 0)
    and (planned_piece_count is null or planned_piece_count > 0)
    and ((planned_piece_length_mm is null) = (planned_piece_count is null))
    and (
      planned_piece_length_mm is null
      or abs(quantity - planned_piece_length_mm * planned_piece_count) <= 0.000001
    )
    and (received_piece_length_mm is null or received_piece_length_mm > 0)
    and (received_piece_count is null or received_piece_count > 0)
    and (
      receipt_parent_schedule_id is not null
      or ((received_piece_length_mm is null) = (received_piece_count is null))
    )
    and (
      receipt_parent_schedule_id is not null
      or received_piece_length_mm is null
      or (
        received_quantity is not null
        and abs(received_quantity - received_piece_length_mm * received_piece_count) <= 0.000001
      )
    )
    and (allocated_piece_count is null or allocated_piece_count >= 0)
    and (excess_quantity is null or excess_quantity >= 0)
  );

create table public.supply_order_delivery_length_discrepancies (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null unique
    references public.supply_order_delivery_schedules(id) on delete restrict,
  planned_piece_length_mm numeric not null check (planned_piece_length_mm > 0),
  received_piece_length_mm numeric not null check (received_piece_length_mm > 0),
  received_by uuid not null references public.users(id) on delete restrict,
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (planned_piece_length_mm <> received_piece_length_mm)
);

create index supply_order_delivery_length_discrepancies_received_at_idx
  on public.supply_order_delivery_length_discrepancies(received_at desc);

alter table public.supply_order_delivery_length_discrepancies enable row level security;
revoke all on table public.supply_order_delivery_length_discrepancies
  from public, anon, authenticated;
grant select on table public.supply_order_delivery_length_discrepancies to authenticated;
grant all on table public.supply_order_delivery_length_discrepancies to service_role;

create policy "Authenticated read supply order delivery length discrepancies"
  on public.supply_order_delivery_length_discrepancies
  for select to authenticated using (true);

create or replace function public.fn_supply_order_delivery_length_discrepancy_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Расхождение длины при приёмке неизменяемо';
end;
$$;

revoke all on function public.fn_supply_order_delivery_length_discrepancy_immutable()
  from public, anon, authenticated;

create trigger supply_order_delivery_length_discrepancy_immutable_trigger
before update or delete on public.supply_order_delivery_length_discrepancies
for each row execute function public.fn_supply_order_delivery_length_discrepancy_immutable();

create or replace function public.fn_guard_supply_order_delivery_piece_plan_fact()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' and new.status = 'planned'
    and (new.received_piece_length_mm is not null or new.received_piece_count is not null) then
    raise exception 'Фактические длина и количество хлыстов записываются только при приёмке';
  end if;

  if tg_op = 'UPDATE' then
    if old.status <> 'planned' and (
      new.planned_piece_length_mm is distinct from old.planned_piece_length_mm
      or new.planned_piece_count is distinct from old.planned_piece_count
    ) then
      raise exception 'Плановые длина и количество хлыстов после приёмки неизменяемы';
    end if;

    if old.received_piece_length_mm is not null and (
      new.received_piece_length_mm is distinct from old.received_piece_length_mm
      or new.received_piece_count is distinct from old.received_piece_count
    ) then
      raise exception 'Фактические длина и количество хлыстов после приёмки неизменяемы';
    end if;

    if new.status = 'planned' and (
      new.received_piece_length_mm is not null or new.received_piece_count is not null
    ) then
      raise exception 'Фактические длина и количество хлыстов записываются только при приёмке';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.fn_guard_supply_order_delivery_piece_plan_fact()
  from public, anon, authenticated;

create trigger supply_order_delivery_piece_plan_fact_guard_trigger
before insert or update on public.supply_order_delivery_schedules
for each row execute function public.fn_guard_supply_order_delivery_piece_plan_fact();

create or replace function public.fn_record_supply_order_delivery_length_discrepancy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.planned_piece_length_mm is not null
    and new.received_piece_length_mm is not null
    and new.received_piece_length_mm <> new.planned_piece_length_mm
    and new.received_by is not null then
    insert into public.supply_order_delivery_length_discrepancies (
      schedule_id,
      planned_piece_length_mm,
      received_piece_length_mm,
      received_by,
      received_at
    ) values (
      new.id,
      new.planned_piece_length_mm,
      new.received_piece_length_mm,
      new.received_by,
      coalesce(new.delivered_at, now())
    )
    on conflict (schedule_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.fn_record_supply_order_delivery_length_discrepancy()
  from public, anon, authenticated;

create trigger supply_order_delivery_length_discrepancy_record_trigger
after insert or update of received_piece_length_mm, received_by, delivered_at
on public.supply_order_delivery_schedules
for each row execute function public.fn_record_supply_order_delivery_length_discrepancy();

create or replace function public.fn_assert_supply_order_delivery_piece_fact()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_schedule public.supply_order_delivery_schedules%rowtype;
begin
  select * into v_schedule
  from public.supply_order_delivery_schedules
  where id = new.id;

  if not found or v_schedule.status <> 'delivered'
    or v_schedule.receipt_parent_schedule_id is not null
    or v_schedule.planned_piece_length_mm is null then
    return null;
  end if;

  if v_schedule.received_piece_length_mm is null
    or v_schedule.received_piece_count is null
    or v_schedule.received_by is null
    or v_schedule.delivered_at is null then
    raise exception 'Приёмка хлыстов требует фактические длину и количество';
  end if;

  if v_schedule.received_piece_length_mm <> v_schedule.planned_piece_length_mm
    and not exists (
      select 1
      from public.supply_order_delivery_length_discrepancies as discrepancy
      where discrepancy.schedule_id = v_schedule.id
        and discrepancy.planned_piece_length_mm = v_schedule.planned_piece_length_mm
        and discrepancy.received_piece_length_mm = v_schedule.received_piece_length_mm
        and discrepancy.received_by = v_schedule.received_by
    ) then
    raise exception 'Расхождение длины при приёмке не зафиксировано';
  end if;

  return null;
end;
$$;

revoke all on function public.fn_assert_supply_order_delivery_piece_fact()
  from public, anon, authenticated;

create constraint trigger supply_order_delivery_piece_fact_constraint_trigger
after insert or update on public.supply_order_delivery_schedules
deferrable initially deferred
for each row execute function public.fn_assert_supply_order_delivery_piece_fact();

-- The only supported receiving entry point is the service-role-only v2 RPC.
-- The legacy overloads either inferred the fact or accepted no bar composition.
drop function if exists public.fn_receive_supply_order_schedule(uuid, uuid);
drop function if exists public.fn_receive_supply_order_schedule(uuid, uuid, numeric);

notify pgrst, 'reload schema';
