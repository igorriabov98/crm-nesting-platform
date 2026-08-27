-- A recalculation is a replacement demand, not an in-place rewrite of a
-- procurement row. The replacement is staged invisibly and activated only by
-- the final approval RPC.

alter table public.technologist_requests
  add column if not exists is_recalculation_staging boolean not null default false;

create index if not exists technologist_requests_visible_machine_idx
  on public.technologist_requests(machine_id, created_at desc)
  where not is_recalculation_staging;

drop policy if exists "Technologist requests read request roles"
  on public.technologist_requests;
create policy "Technologist requests read request roles"
  on public.technologist_requests for select to authenticated
  using (not is_recalculation_staging and public.security_can_view_request_materials());

drop policy if exists "Technologist requests insert request roles"
  on public.technologist_requests;
create policy "Technologist requests insert request roles"
  on public.technologist_requests for insert to authenticated
  with check (not is_recalculation_staging and public.security_can_manage_request_materials());

drop policy if exists "Technologist requests update request roles"
  on public.technologist_requests;
create policy "Technologist requests update request roles"
  on public.technologist_requests for update to authenticated
  using (not is_recalculation_staging and public.security_can_manage_request_materials())
  with check (not is_recalculation_staging and public.security_can_manage_request_materials());

alter table public.request_circle
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.users(id) on delete restrict,
  add column if not exists cancellation_reason text;

alter table public.request_pipe
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.users(id) on delete restrict,
  add column if not exists cancellation_reason text;

alter table public.request_knives
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.users(id) on delete restrict,
  add column if not exists cancellation_reason text;

drop policy if exists "Request circle read request roles" on public.request_circle;
create policy "Request circle read request roles"
  on public.request_circle for select to authenticated
  using (
    public.security_can_view_request_materials()
    and exists (
      select 1 from public.technologist_requests request
      where request.id = request_circle.request_id and not request.is_recalculation_staging
    )
  );
drop policy if exists "Request pipe read request roles" on public.request_pipe;
create policy "Request pipe read request roles"
  on public.request_pipe for select to authenticated
  using (
    public.security_can_view_request_materials()
    and exists (
      select 1 from public.technologist_requests request
      where request.id = request_pipe.request_id and not request.is_recalculation_staging
    )
  );
drop policy if exists "Request knives read request roles" on public.request_knives;
create policy "Request knives read request roles"
  on public.request_knives for select to authenticated
  using (
    public.security_can_view_request_materials()
    and exists (
      select 1 from public.technologist_requests request
      where request.id = request_knives.request_id and not request.is_recalculation_staging
    )
  );

drop policy if exists "Request circle insert request roles" on public.request_circle;
create policy "Request circle insert request roles"
  on public.request_circle for insert to authenticated
  with check (
    public.security_can_manage_request_materials()
    and exists (
      select 1 from public.technologist_requests request
      where request.id = request_circle.request_id and not request.is_recalculation_staging
    )
  );
drop policy if exists "Request circle update request roles" on public.request_circle;
create policy "Request circle update request roles"
  on public.request_circle for update to authenticated
  using (
    public.security_can_manage_request_materials()
    and exists (
      select 1 from public.technologist_requests request
      where request.id = request_circle.request_id and not request.is_recalculation_staging
    )
  )
  with check (
    public.security_can_manage_request_materials()
    and exists (
      select 1 from public.technologist_requests request
      where request.id = request_circle.request_id and not request.is_recalculation_staging
    )
  );
drop policy if exists "Request circle delete request roles" on public.request_circle;
create policy "Request circle delete request roles"
  on public.request_circle for delete to authenticated
  using (
    public.security_can_manage_request_materials()
    and exists (
      select 1 from public.technologist_requests request
      where request.id = request_circle.request_id and not request.is_recalculation_staging
    )
  );

drop policy if exists "Request pipe insert request roles" on public.request_pipe;
create policy "Request pipe insert request roles"
  on public.request_pipe for insert to authenticated
  with check (
    public.security_can_manage_request_materials()
    and exists (
      select 1 from public.technologist_requests request
      where request.id = request_pipe.request_id and not request.is_recalculation_staging
    )
  );
drop policy if exists "Request pipe update request roles" on public.request_pipe;
create policy "Request pipe update request roles"
  on public.request_pipe for update to authenticated
  using (
    public.security_can_manage_request_materials()
    and exists (
      select 1 from public.technologist_requests request
      where request.id = request_pipe.request_id and not request.is_recalculation_staging
    )
  )
  with check (
    public.security_can_manage_request_materials()
    and exists (
      select 1 from public.technologist_requests request
      where request.id = request_pipe.request_id and not request.is_recalculation_staging
    )
  );
drop policy if exists "Request pipe delete request roles" on public.request_pipe;
create policy "Request pipe delete request roles"
  on public.request_pipe for delete to authenticated
  using (
    public.security_can_manage_request_materials()
    and exists (
      select 1 from public.technologist_requests request
      where request.id = request_pipe.request_id and not request.is_recalculation_staging
    )
  );

drop policy if exists "Request knives insert request roles" on public.request_knives;
create policy "Request knives insert request roles"
  on public.request_knives for insert to authenticated
  with check (
    public.security_can_manage_request_materials()
    and exists (
      select 1 from public.technologist_requests request
      where request.id = request_knives.request_id and not request.is_recalculation_staging
    )
  );
drop policy if exists "Request knives update request roles" on public.request_knives;
create policy "Request knives update request roles"
  on public.request_knives for update to authenticated
  using (
    public.security_can_manage_request_materials()
    and exists (
      select 1 from public.technologist_requests request
      where request.id = request_knives.request_id and not request.is_recalculation_staging
    )
  )
  with check (
    public.security_can_manage_request_materials()
    and exists (
      select 1 from public.technologist_requests request
      where request.id = request_knives.request_id and not request.is_recalculation_staging
    )
  );
drop policy if exists "Request knives delete request roles" on public.request_knives;
create policy "Request knives delete request roles"
  on public.request_knives for delete to authenticated
  using (
    public.security_can_manage_request_materials()
    and exists (
      select 1 from public.technologist_requests request
      where request.id = request_knives.request_id and not request.is_recalculation_staging
    )
  );

alter table public.request_circle
  drop constraint if exists request_circle_cancellation_check;
alter table public.request_circle
  add constraint request_circle_cancellation_check check (
    (order_status = 'cancelled') = (
      cancelled_at is not null
      and cancelled_by is not null
      and btrim(coalesce(cancellation_reason, '')) <> ''
    )
  );

alter table public.request_pipe
  drop constraint if exists request_pipe_cancellation_check;
alter table public.request_pipe
  add constraint request_pipe_cancellation_check check (
    (order_status = 'cancelled') = (
      cancelled_at is not null
      and cancelled_by is not null
      and btrim(coalesce(cancellation_reason, '')) <> ''
    )
  );

alter table public.request_knives
  drop constraint if exists request_knives_cancellation_check;
alter table public.request_knives
  add constraint request_knives_cancellation_check check (
    (order_status = 'cancelled') = (
      cancelled_at is not null
      and cancelled_by is not null
      and btrim(coalesce(cancellation_reason, '')) <> ''
    )
  );

-- Cancelled rows remain readable as history, but no new procurement or stock
-- mutation may target them after the replacement becomes active.
create or replace function public.fn_reject_cancelled_long_stock_request_item_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cancelled boolean := false;
begin
  if new.request_item_table not in ('request_circle', 'request_pipe', 'request_knives') then
    return new;
  end if;
  execute format(
    'select order_status = ''cancelled'' from public.%I where id = $1',
    new.request_item_table
  ) into v_cancelled using new.request_item_id;
  if coalesce(v_cancelled, false) then
    raise exception 'Отменённая по пересчёту позиция недоступна для закупки и резервирования';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_cancelled_long_stock_schedule
  on public.supply_order_delivery_schedules;
create trigger reject_cancelled_long_stock_schedule
before insert or update on public.supply_order_delivery_schedules
for each row execute function public.fn_reject_cancelled_long_stock_request_item_mutation();

drop trigger if exists reject_cancelled_long_stock_reservation
  on public.inventory_reservations;
create trigger reject_cancelled_long_stock_reservation
before insert or update on public.inventory_reservations
for each row execute function public.fn_reject_cancelled_long_stock_request_item_mutation();

revoke all on function public.fn_reject_cancelled_long_stock_request_item_mutation()
  from public, anon, authenticated, service_role;

create or replace function public.fn_guard_cancelled_long_stock_request_item_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.order_status = 'cancelled' then
    raise exception 'Отменённая по пересчёту позиция сохранена как неизменяемая история';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_cancelled_request_circle_history on public.request_circle;
create trigger guard_cancelled_request_circle_history
before update or delete on public.request_circle
for each row execute function public.fn_guard_cancelled_long_stock_request_item_history();
drop trigger if exists guard_cancelled_request_pipe_history on public.request_pipe;
create trigger guard_cancelled_request_pipe_history
before update or delete on public.request_pipe
for each row execute function public.fn_guard_cancelled_long_stock_request_item_history();
drop trigger if exists guard_cancelled_request_knives_history on public.request_knives;
create trigger guard_cancelled_request_knives_history
before update or delete on public.request_knives
for each row execute function public.fn_guard_cancelled_long_stock_request_item_history();

revoke all on function public.fn_guard_cancelled_long_stock_request_item_history()
  from public, anon, authenticated, service_role;

-- Machine procurement aggregation must ignore historical cancelled rows.
do $migration$
declare
  v_definition text;
  v_anchor constant text := E'  ) all_items;';
  v_replacement constant text := E'  ) all_items\n  where os <> ''cancelled'';';
begin
  v_definition := pg_get_functiondef(
    'public.fn_check_order_status_and_update_machine()'::regprocedure
  );
  if position(v_anchor in v_definition) = 0 then
    raise exception 'Не найден агрегат закупочных статусов машины';
  end if;
  execute replace(v_definition, v_anchor, v_replacement);
end;
$migration$;

alter table public.long_stock_cutting_plan_items
  add column if not exists link_state text not null default 'active';

alter table public.long_stock_cutting_plan_items
  drop constraint if exists long_stock_cutting_plan_items_link_state_check;
alter table public.long_stock_cutting_plan_items
  add constraint long_stock_cutting_plan_items_link_state_check
  check (link_state in ('active', 'replacement_staging', 'superseded'));

create table public.long_stock_recalculation_replacements (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.long_stock_cutting_plans(id) on delete restrict,
  plan_item_id uuid not null references public.long_stock_cutting_plan_items(id) on delete restrict,
  source_version_id uuid not null unique
    references public.long_stock_cutting_plan_versions(id) on delete restrict,
  source_kind text not null
    check (source_kind in ('supply_return', 'supply_receipt', 'inventory_transfer')),
  source_request_id uuid not null references public.technologist_requests(id) on delete restrict,
  source_request_item_table text not null
    check (source_request_item_table in ('request_circle', 'request_pipe', 'request_knives')),
  source_request_item_id uuid not null,
  replacement_request_id uuid not null unique
    references public.technologist_requests(id) on delete restrict,
  replacement_request_item_table text not null
    check (replacement_request_item_table in ('request_circle', 'request_pipe', 'request_knives')),
  replacement_request_item_id uuid not null unique,
  replacement_version_id uuid unique
    references public.long_stock_cutting_plan_versions(id) on delete restrict,
  allowed_lengths_mm numeric[] not null,
  status text not null default 'replacement_staging'
    check (status in ('replacement_staging', 'superseded')),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  approved_by uuid references public.users(id) on delete restrict,
  approved_at timestamptz,
  check (cardinality(allowed_lengths_mm) > 0),
  check (
    (status = 'replacement_staging' and replacement_version_id is null and approved_by is null and approved_at is null)
    or
    (status = 'superseded' and replacement_version_id is not null and approved_by is not null and approved_at is not null)
  ),
  unique (source_request_item_table, source_request_item_id, source_version_id),
  unique (replacement_request_item_table, replacement_request_item_id)
);

create index long_stock_recalculation_replacements_source_item_idx
  on public.long_stock_recalculation_replacements(source_request_item_table, source_request_item_id);

alter table public.long_stock_recalculation_replacements enable row level security;
revoke all on table public.long_stock_recalculation_replacements
  from public, anon, authenticated;
grant select, insert, update on table public.long_stock_recalculation_replacements
  to service_role;

create or replace function public.fn_guard_long_stock_recalculation_replacement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Связь исходной и заменяющей позиции неизменяема';
  end if;
  if tg_op = 'UPDATE' then
    if current_setting('app.long_stock_replacement_approval', true) <> '1' then
      raise exception 'Связь исходной и заменяющей позиции изменяется только RPC утверждения';
    end if;
    if new.id is distinct from old.id
      or new.plan_id is distinct from old.plan_id
      or new.plan_item_id is distinct from old.plan_item_id
      or new.source_version_id is distinct from old.source_version_id
      or new.source_kind is distinct from old.source_kind
      or new.source_request_id is distinct from old.source_request_id
      or new.source_request_item_table is distinct from old.source_request_item_table
      or new.source_request_item_id is distinct from old.source_request_item_id
      or new.replacement_request_id is distinct from old.replacement_request_id
      or new.replacement_request_item_table is distinct from old.replacement_request_item_table
      or new.replacement_request_item_id is distinct from old.replacement_request_item_id
      or new.allowed_lengths_mm is distinct from old.allowed_lengths_mm
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'Идентичность связи исходной и заменяющей позиции неизменяема';
    end if;
    if old.status = 'superseded' and new is distinct from old then
      raise exception 'Утверждённая связь исходной и заменяющей позиции неизменяема';
    end if;
  end if;
  return new;
end;
$$;

create trigger long_stock_recalculation_replacement_guard
before update or delete on public.long_stock_recalculation_replacements
for each row execute function public.fn_guard_long_stock_recalculation_replacement();

revoke all on function public.fn_guard_long_stock_recalculation_replacement()
  from public, anon, authenticated, service_role;

-- Keep the established status transition guard, but permit one audited
-- identity switch from the cancelled source item to its staged replacement.
create or replace function public.fn_long_stock_cutting_plan_item_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_id uuid;
  v_material_variant_id uuid;
  v_pipe_type public.pipe_subtype;
  v_plan_variant_id uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'Связь карты раскроя с позицией заявки неизменяема';
  end if;

  if tg_op = 'UPDATE'
    and current_setting('app.long_stock_cutting_replacement_lifecycle', true) <> '1' then
    if current_setting('app.long_stock_cutting_item_status', true) <> '1' then
      raise exception 'Статус позиции карты раскроя меняется только атомарным RPC';
    end if;
    if new.id is distinct from old.id
      or new.plan_id is distinct from old.plan_id
      or new.request_item_table is distinct from old.request_item_table
      or new.request_item_id is distinct from old.request_item_id
      or new.request_id is distinct from old.request_id
      or new.linked_by is distinct from old.linked_by
      or new.linked_at is distinct from old.linked_at
      or new.link_state is distinct from old.link_state then
      raise exception 'Связь карты раскроя с позицией заявки неизменяема';
    end if;
    if new.cutting_status is distinct from old.cutting_status
      and not (
        (old.cutting_status = 'planning' and new.cutting_status in ('plan_approved', 'accepted'))
        or (old.cutting_status in ('plan_approved', 'accepted') and new.cutting_status = 'requires_recalculation')
        or (old.cutting_status = 'requires_recalculation' and new.cutting_status in ('plan_approved', 'accepted'))
      ) then
      raise exception 'Недопустимый переход статуса позиции карты раскроя: % -> %',
        old.cutting_status, new.cutting_status;
    end if;
    return new;
  end if;

  if new.request_item_table = 'request_circle' then
    select request_id, material_variant_id
    into v_request_id, v_material_variant_id
    from public.request_circle where id = new.request_item_id;
  elsif new.request_item_table = 'request_pipe' then
    select request_id, material_variant_id, pipe_type
    into v_request_id, v_material_variant_id, v_pipe_type
    from public.request_pipe where id = new.request_item_id;
    if v_pipe_type = 'wire' then
      raise exception 'Проволока не входит в раскрой длинномера';
    end if;
  elsif new.request_item_table = 'request_knives' then
    select request_id, material_variant_id
    into v_request_id, v_material_variant_id
    from public.request_knives where id = new.request_item_id;
  else
    raise exception 'Позиция не относится к длинномеру';
  end if;

  if v_request_id is null then raise exception 'Позиция заявки длинномера не найдена'; end if;
  if v_material_variant_id is null then
    raise exception 'Для позиции заявки не выбран точный вариант материала';
  end if;
  select material_variant_id into v_plan_variant_id
  from public.long_stock_cutting_plans where id = new.plan_id;
  if v_plan_variant_id is distinct from v_material_variant_id then
    raise exception 'Позиции одного плана должны иметь одинаковый вариант материала';
  end if;

  if tg_op = 'UPDATE'
    and current_setting('app.long_stock_cutting_replacement_lifecycle', true) = '1' then
    if new.id is distinct from old.id
      or new.plan_id is distinct from old.plan_id
      or new.linked_by is distinct from old.linked_by
      or new.linked_at is distinct from old.linked_at then
      raise exception 'Техническая идентичность позиции карты раскроя неизменяема';
    end if;
  end if;
  new.request_id := v_request_id;
  return new;
end;
$$;

revoke all on function public.fn_long_stock_cutting_plan_item_guard()
  from public, anon, authenticated, service_role;

create or replace function public.fn_prepare_long_stock_recalculation_replacement_v1(
  p_source_request_item_table text,
  p_source_request_item_id uuid,
  p_source_version_id uuid,
  p_source_kind text,
  p_allowed_lengths_mm numeric[],
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.long_stock_recalculation_replacements%rowtype;
  v_plan_item public.long_stock_cutting_plan_items%rowtype;
  v_invalid_version public.long_stock_cutting_plan_versions%rowtype;
  v_source_item jsonb;
  v_source_request public.technologist_requests%rowtype;
  v_replacement_request_id uuid := gen_random_uuid();
  v_replacement_item_id uuid := gen_random_uuid();
  v_detected_source_kind text;
  v_allowed_lengths numeric[];
  v_total_length_mm numeric;
  v_piece_count integer;
  v_weight_per_m numeric;
  v_calculated_weight numeric;
begin
  if p_source_request_item_table not in ('request_circle', 'request_pipe', 'request_knives') then
    raise exception 'Позиция не относится к кругу, трубе или ножам';
  end if;
  if p_source_request_item_id is null or p_source_version_id is null then
    raise exception 'Не указаны исходная позиция или версия пересчёта';
  end if;
  if not exists (
    select 1 from public.users where id = p_actor and coalesce(is_active, true)
  ) then
    raise exception 'Необходим активный автор пересчёта';
  end if;

  select array_agg(length_mm order by length_mm)
  into v_allowed_lengths
  from (
    select distinct length_mm
    from unnest(coalesce(p_allowed_lengths_mm, '{}'::numeric[])) length_mm
    where length_mm > 0 and trunc(length_mm) = length_mm
  ) normalized;
  if coalesce(cardinality(v_allowed_lengths), 0) = 0 then
    raise exception 'Для пересчёта не указаны допустимые длины хлыстов';
  end if;

  select * into v_existing
  from public.long_stock_recalculation_replacements
  where source_version_id = p_source_version_id
  for update;
  if found then
    if v_existing.source_request_item_table is distinct from p_source_request_item_table
      or v_existing.source_request_item_id is distinct from p_source_request_item_id
      or v_existing.source_kind is distinct from p_source_kind
      or v_existing.allowed_lengths_mm is distinct from v_allowed_lengths then
      raise exception 'Параметры уже подготовленной замены отличаются; обновите пересчёт';
    end if;
    return jsonb_build_object(
      'replacement_id', v_existing.id,
      'plan_id', v_existing.plan_id,
      'plan_item_id', v_existing.plan_item_id,
      'source_request_id', v_existing.source_request_id,
      'source_request_item_table', v_existing.source_request_item_table,
      'source_request_item_id', v_existing.source_request_item_id,
      'replacement_request_id', v_existing.replacement_request_id,
      'replacement_request_item_table', v_existing.replacement_request_item_table,
      'replacement_request_item_id', v_existing.replacement_request_item_id,
      'source_kind', v_existing.source_kind,
      'status', v_existing.status
    );
  end if;

  select item.* into v_plan_item
  from public.long_stock_cutting_plan_items item
  where item.request_item_table = p_source_request_item_table
    and item.request_item_id = p_source_request_item_id
    and item.cutting_status = 'requires_recalculation'
  order by item.linked_at desc, item.id desc
  limit 1
  for update;
  if not found then raise exception 'Исходная позиция не требует пересчёта'; end if;

  select * into v_invalid_version
  from public.long_stock_cutting_plan_versions
  where id = p_source_version_id
    and plan_id = v_plan_item.plan_id
    and status = 'invalid'
  for update;
  if not found then raise exception 'Текущая недействительная версия карты не найдена'; end if;

  v_detected_source_kind := case
    when v_invalid_version.invalidation_department_request_id is not null then 'supply_return'
    when v_invalid_version.invalidation_receipt_schedule_id is not null then 'supply_receipt'
    when v_invalid_version.invalidation_inventory_transfer_id is not null then 'inventory_transfer'
    else null
  end;
  if v_detected_source_kind is distinct from p_source_kind then
    raise exception 'Источник пересчёта изменился; обновите данные';
  end if;

  execute format(
    'select to_jsonb(item) from public.%I item where item.id = $1 for update',
    p_source_request_item_table
  ) into v_source_item using p_source_request_item_id;
  if v_source_item is null then raise exception 'Исходная позиция заявки не найдена'; end if;
  if p_source_request_item_table = 'request_pipe' and v_source_item->>'pipe_type' = 'wire' then
    raise exception 'Проволока не участвует в пересчёте карты раскроя';
  end if;

  select * into v_source_request
  from public.technologist_requests
  where id = v_plan_item.request_id
  for update;
  if not found then raise exception 'Исходная заявка технолога не найдена'; end if;

  select coalesce(sum(segment.required_length_mm), 0), count(*)::integer
  into v_total_length_mm, v_piece_count
  from public.long_stock_cutting_segments segment
  where segment.version_id = v_invalid_version.id
    and not exists (
      select 1
      from public.long_stock_cutting_bar_cuts cut
      join public.long_stock_cutting_candidate_bars bar on bar.id = cut.bar_id
      join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
      where cut.segment_id = segment.id
        and candidate.version_id = v_invalid_version.id
        and candidate.candidate_number = v_invalid_version.selected_candidate_number
        and bar.status = 'cut'
    );
  if v_total_length_mm <= 0 or v_piece_count <= 0 then
    raise exception 'Все заготовки исходной версии уже порезаны';
  end if;

  select variant.weight_per_m_kg into v_weight_per_m
  from public.material_variants variant
  where variant.id = nullif(v_source_item->>'material_variant_id', '')::uuid;
  v_calculated_weight := case
    when coalesce(v_weight_per_m, 0) > 0 then v_total_length_mm * v_weight_per_m / 1000
    else null
  end;

  insert into public.technologist_requests(
    id, machine_id, created_by, status, notes, is_recalculation_staging
  ) values (
    v_replacement_request_id,
    v_source_request.machine_id,
    p_actor,
    'draft',
    'Скрытая замена позиции по пересчёту карты раскроя',
    true
  );

  if p_source_request_item_table = 'request_circle' then
    insert into public.request_circle(
      id, request_id, diameter_mm, steel_grade, is_calibrated, remainder_mm,
      material_id, material_variant_id, custom_delivery_date, order_status,
      ordered_at, delivered_at, reserved_from_stock_mm, steel_type_id,
      calculated_weight_kg, is_custom_material_variant, sort_order, supplier_id
    ) values (
      v_replacement_item_id, v_replacement_request_id,
      nullif(v_source_item->>'diameter_mm', '')::numeric,
      nullif(v_source_item->>'steel_grade', ''),
      coalesce((v_source_item->>'is_calibrated')::boolean, false),
      v_total_length_mm,
      nullif(v_source_item->>'material_id', '')::uuid,
      nullif(v_source_item->>'material_variant_id', '')::uuid,
      null, 'pending', null, null, 0,
      nullif(v_source_item->>'steel_type_id', '')::uuid,
      v_calculated_weight,
      coalesce((v_source_item->>'is_custom_material_variant')::boolean, false),
      0, null
    );
  elsif p_source_request_item_table = 'request_pipe' then
    insert into public.request_pipe(
      id, request_id, pipe_type, size, wall_thickness_mm, diameter_mm,
      remainder_length_mm, remainder_qty, remainder_kg,
      material_id, material_variant_id, custom_delivery_date, order_status,
      ordered_at, delivered_at, reserved_from_stock_length_mm,
      reserved_from_stock_qty, reserved_from_stock_kg, steel_type_id,
      calculated_weight_kg, is_custom_material_variant, sort_order, supplier_id
    ) values (
      v_replacement_item_id, v_replacement_request_id,
      (v_source_item->>'pipe_type')::public.pipe_subtype,
      nullif(v_source_item->>'size', ''),
      nullif(v_source_item->>'wall_thickness_mm', '')::numeric,
      nullif(v_source_item->>'diameter_mm', '')::numeric,
      v_total_length_mm, v_piece_count, coalesce(v_calculated_weight, 0),
      nullif(v_source_item->>'material_id', '')::uuid,
      nullif(v_source_item->>'material_variant_id', '')::uuid,
      null, 'pending', null, null, 0, 0, 0,
      nullif(v_source_item->>'steel_type_id', '')::uuid,
      v_calculated_weight,
      coalesce((v_source_item->>'is_custom_material_variant')::boolean, false),
      0, null
    );
  else
    insert into public.request_knives(
      id, request_id, knife_type, order_mm, will_be_used_mm, stock_remainder_mm,
      sort_order, order_status, ordered_at, delivered_at, custom_delivery_date,
      material_id, material_variant_id, reserved_from_stock_mm, steel_grade,
      length_mm, width_mm, height_mm, steel_type_id, calculated_weight_kg,
      is_custom_material_variant, remainder_meters, remainder_qty,
      knife_bevel_count, reserved_from_stock_qty, supplier_id
    ) values (
      v_replacement_item_id, v_replacement_request_id,
      coalesce(nullif(v_source_item->>'knife_type', ''), 'Ножи'),
      v_total_length_mm, v_total_length_mm, 0,
      0, 'pending', null, null, null,
      nullif(v_source_item->>'material_id', '')::uuid,
      nullif(v_source_item->>'material_variant_id', '')::uuid,
      0,
      nullif(v_source_item->>'steel_grade', ''),
      nullif(v_source_item->>'length_mm', '')::numeric,
      nullif(v_source_item->>'width_mm', '')::numeric,
      nullif(v_source_item->>'height_mm', '')::numeric,
      nullif(v_source_item->>'steel_type_id', '')::uuid,
      v_calculated_weight,
      coalesce((v_source_item->>'is_custom_material_variant')::boolean, false),
      v_total_length_mm / 1000, v_piece_count,
      nullif(v_source_item->>'knife_bevel_count', '')::smallint,
      0, null
    );
  end if;

  insert into public.long_stock_recalculation_replacements(
    plan_id, plan_item_id, source_version_id, source_kind,
    source_request_id, source_request_item_table, source_request_item_id,
    replacement_request_id, replacement_request_item_table,
    replacement_request_item_id, allowed_lengths_mm, created_by
  ) values (
    v_plan_item.plan_id, v_plan_item.id, v_invalid_version.id, v_detected_source_kind,
    v_source_request.id, p_source_request_item_table, p_source_request_item_id,
    v_replacement_request_id, p_source_request_item_table,
    v_replacement_item_id, v_allowed_lengths, p_actor
  ) returning * into v_existing;

  perform set_config('app.long_stock_cutting_replacement_lifecycle', '1', true);
  update public.long_stock_cutting_plan_items
  set link_state = 'replacement_staging'
  where id = v_plan_item.id;
  perform set_config('app.long_stock_cutting_replacement_lifecycle', '', true);

  return jsonb_build_object(
    'replacement_id', v_existing.id,
    'plan_id', v_existing.plan_id,
    'plan_item_id', v_existing.plan_item_id,
    'source_request_id', v_existing.source_request_id,
    'source_request_item_table', v_existing.source_request_item_table,
    'source_request_item_id', v_existing.source_request_item_id,
    'replacement_request_id', v_existing.replacement_request_id,
    'replacement_request_item_table', v_existing.replacement_request_item_table,
    'replacement_request_item_id', v_existing.replacement_request_item_id,
    'source_kind', v_existing.source_kind,
    'status', v_existing.status
  );
end;
$$;

revoke all on function public.fn_prepare_long_stock_recalculation_replacement_v1(
  text, uuid, uuid, text, numeric[], uuid
) from public, anon, authenticated;
grant execute on function public.fn_prepare_long_stock_recalculation_replacement_v1(
  text, uuid, uuid, text, numeric[], uuid
) to service_role;

-- The historical receipt wrapper validates against the plan item's current
-- request row and creates a direct supply-shortage task. Replacement approval
-- performs stricter source validation itself and deliberately routes the new
-- demand through stock check instead of that legacy shortcut.
do $migration$
declare
  v_definition text;
  v_validation_anchor text := E'    if (\n      select invalidation_receipt_schedule_id';
  v_validation_replacement text := E'    if nullif(v_version.input_snapshot#>>''{recalculation,replacement_id}'', '''') is null\n      and (\n      select invalidation_receipt_schedule_id';
  v_shortage_anchor text := E'    if v_shortage_composition is not null then';
  v_shortage_replacement text := E'    if v_shortage_composition is not null\n      and nullif(v_version.input_snapshot#>>''{recalculation,replacement_id}'', '''') is null then';
begin
  v_definition := pg_get_functiondef(
    'public.fn_approve_long_stock_cutting_plan_version_before_supply_return(uuid,uuid)'::regprocedure
  );
  if position(v_validation_anchor in v_definition) = 0 then
    raise exception 'Не найдено legacy-условие проверки фактической приёмки';
  end if;
  if position(v_shortage_anchor in v_definition) = 0 then
    raise exception 'Не найдено legacy-условие создания задачи дозаказа';
  end if;
  v_definition := replace(v_definition, v_validation_anchor, v_validation_replacement);
  v_definition := replace(v_definition, v_shortage_anchor, v_shortage_replacement);
  execute v_definition;
end;
$migration$;

alter function public.fn_approve_long_stock_cutting_plan_version_v2(uuid, uuid, jsonb)
  rename to fn_approve_long_stock_cutting_plan_pdf_before_replacement_v1;

revoke all on function public.fn_approve_long_stock_cutting_plan_pdf_before_replacement_v1(
  uuid, uuid, jsonb
) from public, anon, authenticated, service_role;

-- Retain v2 for ordinary plan approval, but make it impossible to approve a
-- replacement snapshot without the finalizer that cancels/moves everything.
create or replace function public.fn_approve_long_stock_cutting_plan_version_v2(
  p_version_id uuid,
  p_actor uuid,
  p_pdf_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_replacement_id uuid;
begin
  select nullif(input_snapshot#>>'{recalculation,replacement_id}', '')::uuid
  into v_replacement_id
  from public.long_stock_cutting_plan_versions
  where id = p_version_id;
  if not found then raise exception 'Версия карты раскроя не найдена'; end if;
  if v_replacement_id is not null then
    raise exception 'Пересчёт утверждается только с созданием заменяющей заявки';
  end if;
  return public.fn_approve_long_stock_cutting_plan_pdf_before_replacement_v1(
    p_version_id, p_actor, p_pdf_metadata
  );
end;
$$;

revoke all on function public.fn_approve_long_stock_cutting_plan_version_v2(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.fn_approve_long_stock_cutting_plan_version_v2(uuid, uuid, jsonb)
  to service_role;

create or replace function public.fn_approve_long_stock_recalculation_replacement_v1(
  p_version_id uuid,
  p_actor uuid,
  p_pdf_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version public.long_stock_cutting_plan_versions%rowtype;
  v_replacement public.long_stock_recalculation_replacements%rowtype;
  v_plan public.long_stock_cutting_plans%rowtype;
  v_snapshot_allowed_lengths numeric[];
  v_current_allowed_lengths numeric[];
  v_result jsonb;
  v_department_request_id uuid;
  v_missing_lengths_message text;
begin
  if not exists (
    select 1 from public.users where id = p_actor and coalesce(is_active, true)
  ) then
    raise exception 'Необходим активный автор утверждения';
  end if;

  select * into v_version
  from public.long_stock_cutting_plan_versions
  where id = p_version_id
  for update;
  if not found then raise exception 'Версия карты раскроя не найдена'; end if;

  select * into v_replacement
  from public.long_stock_recalculation_replacements
  where id = nullif(v_version.input_snapshot#>>'{recalculation,replacement_id}', '')::uuid
  for update;
  if not found then raise exception 'Скрытая заменяющая заявка пересчёта не найдена'; end if;

  if v_replacement.status = 'superseded' then
    if v_replacement.replacement_version_id is distinct from p_version_id then
      raise exception 'Исходная позиция уже заменена другой версией карты';
    end if;
    return jsonb_build_object(
      'version_id', p_version_id,
      'status', 'approved',
      'position_status', (
        select cutting_status from public.long_stock_cutting_plan_items
        where id = v_replacement.plan_item_id
      ),
      'source_request_id', v_replacement.source_request_id,
      'source_request_item_id', v_replacement.source_request_item_id,
      'replacement_request_id', v_replacement.replacement_request_id,
      'replacement_request_item_id', v_replacement.replacement_request_item_id,
      'machine_id', (
        select machine_id from public.technologist_requests
        where id = v_replacement.replacement_request_id
      )
    );
  end if;

  if v_version.status <> 'draft' then
    raise exception 'Утвердить можно только черновик версии пересчёта';
  end if;
  if v_replacement.plan_id is distinct from v_version.plan_id
    or v_replacement.source_version_id is distinct from
      nullif(v_version.input_snapshot#>>'{recalculation,source_version_id}', '')::uuid
    or v_replacement.source_kind is distinct from
      v_version.input_snapshot#>>'{recalculation,source_kind}'
    or v_replacement.source_request_item_table is distinct from
      v_version.input_snapshot#>>'{recalculation,source_request_item,table}'
    or v_replacement.source_request_item_id is distinct from
      nullif(v_version.input_snapshot#>>'{recalculation,source_request_item,id}', '')::uuid
    or v_replacement.replacement_request_id is distinct from
      nullif(v_version.input_snapshot#>>'{recalculation,replacement_request_id}', '')::uuid
    or v_replacement.replacement_request_item_id is distinct from
      nullif(v_version.input_snapshot#>>'{recalculation,replacement_request_item,id}', '')::uuid then
    raise exception 'Snapshot версии не соответствует подготовленной замене';
  end if;

  if not exists (
    select 1 from public.long_stock_cutting_plan_versions invalid_version
    where invalid_version.id = v_replacement.source_version_id
      and invalid_version.plan_id = v_replacement.plan_id
      and invalid_version.status = 'invalid'
  ) or not exists (
    select 1 from public.long_stock_cutting_plan_items item
    where item.id = v_replacement.plan_item_id
      and item.plan_id = v_replacement.plan_id
      and item.request_item_table = v_replacement.source_request_item_table
      and item.request_item_id = v_replacement.source_request_item_id
      and item.cutting_status = 'requires_recalculation'
      and item.link_state = 'replacement_staging'
  ) then
    raise exception 'Исходная недействительная версия уже изменилась';
  end if;

  if not exists (
    select 1 from public.technologist_requests request
    where request.id = v_replacement.replacement_request_id
      and request.status = 'draft'
      and request.is_recalculation_staging
  ) then
    raise exception 'Заменяющая заявка изменилась до утверждения';
  end if;

  select array_agg(length_mm order by length_mm)
  into v_snapshot_allowed_lengths
  from (
    select distinct value::numeric as length_mm
    from jsonb_array_elements_text(
      coalesce(v_version.input_snapshot#>'{recalculation,allowed_lengths_mm}', '[]'::jsonb)
    ) value
  ) normalized;
  if v_snapshot_allowed_lengths is distinct from v_replacement.allowed_lengths_mm then
    raise exception 'Допустимые длины snapshot изменились; пересчитайте карту';
  end if;

  select * into v_plan
  from public.long_stock_cutting_plans
  where id = v_replacement.plan_id
  for update;

  if v_replacement.source_kind = 'supply_return' then
    select array_agg(length_mm order by length_mm)
    into v_current_allowed_lengths
    from (
      select distinct length_json::numeric as length_mm
      from jsonb_array_elements(
        public.fn_get_long_stock_layout_settings_snapshot()->'categories'
      ) categories(category_json)
      cross join lateral jsonb_array_elements(
        coalesce((category_json->'standard_lengths'), '[]'::jsonb)
        || case
          when v_version.input_snapshot->>'mode' = 'with_nonstandard'
            then coalesce(category_json->'nonstandard_lengths', '[]'::jsonb)
          else '[]'::jsonb
        end
      ) lengths(length_json)
      where category_json->>'key' = v_plan.layout_category_key
    ) lengths;
  elsif v_replacement.source_kind = 'supply_receipt' then
    select array_agg(length_mm order by length_mm)
    into v_current_allowed_lengths
    from (
      select distinct schedule.received_piece_length_mm as length_mm
      from public.supply_order_delivery_schedules schedule
      where schedule.request_item_table = v_replacement.source_request_item_table
        and schedule.request_item_id = v_replacement.source_request_item_id
        and schedule.status = 'delivered'
        and schedule.received_piece_length_mm is not null
        and coalesce(
          schedule.allocated_piece_count,
          schedule.received_piece_count,
          schedule.allocated_physical_quantity / nullif(schedule.received_piece_length_mm, 0),
          schedule.received_quantity / nullif(schedule.received_piece_length_mm, 0),
          0
        ) > 0
    ) lengths;
  else
    select array_agg(length_mm order by length_mm)
    into v_current_allowed_lengths
    from (
      select distinct transfer_item.piece_length_mm as length_mm
      from public.inventory_transfer_items transfer_item
      where transfer_item.request_item_table = v_replacement.source_request_item_table
        and transfer_item.request_item_id = v_replacement.source_request_item_id
        and transfer_item.piece_length_mm is not null
        and coalesce(
          transfer_item.received_secondary_quantity,
          transfer_item.received_quantity / nullif(transfer_item.piece_length_mm, 0),
          0
        ) > 0
    ) lengths;
  end if;

  if coalesce(cardinality(v_current_allowed_lengths), 0) = 0 then
    v_missing_lengths_message := case v_replacement.source_kind
      when 'supply_return' then 'В актуальных настройках не найдены допустимые длины хлыстов'
      when 'supply_receipt' then 'Не найдены фактически принятые длины, включая распределённые поставки'
      else 'Не найдены фактически принятые длины межзаводского перемещения'
    end;
    raise exception '%', v_missing_lengths_message;
  end if;
  if v_current_allowed_lengths is distinct from v_replacement.allowed_lengths_mm then
    raise exception 'Источник допустимых длин изменился; обновите пересчёт';
  end if;
  if exists (
    select 1
    from public.long_stock_cutting_candidates candidate
    join public.long_stock_cutting_candidate_bars bar on bar.candidate_id = candidate.id
    where candidate.version_id = p_version_id
      and candidate.candidate_number = v_version.selected_candidate_number
      and bar.source_type = 'new_stock'
      and not (bar.stock_length_mm = any(v_current_allowed_lengths))
  ) then
    raise exception 'Новая карта использует длину вне актуального источника пересчёта';
  end if;

  v_result := public.fn_approve_long_stock_cutting_plan_pdf_before_replacement_v1(
    p_version_id, p_actor, p_pdf_metadata
  );
  if (select status from public.long_stock_cutting_plan_versions where id = p_version_id) <> 'approved' then
    raise exception 'Источник физического материала изменился во время утверждения; обновите пересчёт';
  end if;

  -- Move only whole, unconsumed physical reservations. Consumed and cut-piece
  -- reservations remain attached to the cancelled source item as history.
  update public.inventory_reservations
  set request_item_table = v_replacement.replacement_request_item_table,
      request_item_id = v_replacement.replacement_request_item_id
  where request_item_table = v_replacement.source_request_item_table
    and request_item_id = v_replacement.source_request_item_id
    and consumed_at is null
    and not is_cut_reservation;

  perform public.fn_set_request_reserved_quantity(
    v_replacement.replacement_request_item_table,
    v_replacement.replacement_request_item_id
  );
  perform public.fn_set_request_reserved_quantity(
    v_replacement.source_request_item_table,
    v_replacement.source_request_item_id
  );

  update public.supply_order_delivery_schedules
  set status = 'cancelled', updated_by = p_actor, updated_at = now()
  where request_item_table = v_replacement.source_request_item_table
    and request_item_id = v_replacement.source_request_item_id
    and status = 'planned';

  execute format(
    'update public.%I set order_status = $1, cancelled_at = now(), cancelled_by = $2, cancellation_reason = $3 where id = $4',
    v_replacement.source_request_item_table
  ) using 'cancelled'::public.order_item_status, p_actor, 'Пересчёт',
    v_replacement.source_request_item_id;

  perform set_config('app.long_stock_cutting_replacement_lifecycle', '1', true);
  update public.long_stock_cutting_plan_items
  set request_item_table = v_replacement.replacement_request_item_table,
      request_item_id = v_replacement.replacement_request_item_id,
      request_id = v_replacement.replacement_request_id,
      link_state = 'active'
  where id = v_replacement.plan_item_id;
  perform set_config('app.long_stock_cutting_replacement_lifecycle', '', true);

  update public.technologist_requests
  set created_by = p_actor,
      status = 'pending_stock_check',
      notes = 'Создана при пересчёте позиции заявки ' || v_replacement.source_request_id::text,
      submitted_at = coalesce(submitted_at, now()),
      is_recalculation_staging = false,
      updated_at = now()
  where id = v_replacement.replacement_request_id;

  select invalidation_department_request_id into v_department_request_id
  from public.long_stock_cutting_plan_versions
  where id = v_replacement.source_version_id;
  if v_department_request_id is not null then
    perform set_config('app.long_stock_recalculation_request_lifecycle', '1', true);
    update public.department_requests
    set status = 'done',
        response = 'Пересчёт утверждён; создана новая заявка технолога',
        completed_by = p_actor,
        completed_at = coalesce(completed_at, now())
    where id = v_department_request_id
      and status in ('new', 'in_progress');
    perform set_config('app.long_stock_recalculation_request_lifecycle', '', true);
  end if;
  update public.tasks
  set status = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now()
  where status in ('pending', 'in_progress')
    and (
      department_request_id = v_department_request_id
      or (
        long_stock_cutting_plan_id = v_replacement.plan_id
        and task_type = 'long_stock_cutting_recalculation'
      )
    );

  perform set_config('app.long_stock_replacement_approval', '1', true);
  update public.long_stock_recalculation_replacements
  set status = 'superseded',
      replacement_version_id = p_version_id,
      approved_by = p_actor,
      approved_at = now()
  where id = v_replacement.id;
  perform set_config('app.long_stock_replacement_approval', '', true);

  return v_result || jsonb_build_object(
    'source_request_id', v_replacement.source_request_id,
    'source_request_item_id', v_replacement.source_request_item_id,
    'replacement_request_id', v_replacement.replacement_request_id,
    'replacement_request_item_id', v_replacement.replacement_request_item_id,
    'machine_id', (
      select machine_id from public.technologist_requests
      where id = v_replacement.replacement_request_id
    )
  );
end;
$$;

revoke all on function public.fn_approve_long_stock_recalculation_replacement_v1(
  uuid, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.fn_approve_long_stock_recalculation_replacement_v1(
  uuid, uuid, jsonb
) to service_role;

-- Every renamed/internal approval signature stays closed. Only v2 (ordinary
-- plans) and the replacement finalizer are callable through the service role.
revoke all on function public.fn_approve_long_stock_cutting_plan_version_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.fn_approve_long_stock_cutting_plan_version_core_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.fn_approve_long_stock_cutting_plan_before_recalculation(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.fn_approve_long_stock_cutting_plan_before_race_serialization(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.fn_approve_long_stock_cutting_plan_pdf_before_race_serialization(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.fn_approve_long_stock_cutting_plan_pdf_before_replacement_v1(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
