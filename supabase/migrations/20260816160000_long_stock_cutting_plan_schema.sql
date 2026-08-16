-- Immutable, versioned data model for long-stock cutting plans.
-- Calculation, UI and downstream request/supply/receiving integration are intentionally out of scope.

create sequence public.long_stock_cutting_plan_number_seq;

create table public.long_stock_cutting_plans (
  id uuid primary key default gen_random_uuid(),
  plan_number bigint not null default nextval('public.long_stock_cutting_plan_number_seq'),
  material_variant_id uuid not null references public.material_variants(id) on delete restrict,
  layout_category_key text not null references public.long_stock_layout_categories(key) on delete restrict,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.users(id) on delete restrict,
  unique (plan_number),
  check ((status = 'closed') = (closed_at is not null)),
  check ((status = 'closed') = (closed_by is not null))
);

create index long_stock_cutting_plans_variant_idx
  on public.long_stock_cutting_plans(material_variant_id, status);

create table public.long_stock_cutting_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.long_stock_cutting_plans(id) on delete restrict,
  request_item_table text not null
    check (request_item_table in ('request_circle', 'request_pipe', 'request_knives')),
  request_item_id uuid not null,
  request_id uuid not null references public.technologist_requests(id) on delete restrict,
  linked_by uuid not null references public.users(id) on delete restrict,
  linked_at timestamptz not null default now(),
  unique (plan_id, request_item_table, request_item_id),
  unique (plan_id, id)
);

create index long_stock_cutting_plan_items_request_idx
  on public.long_stock_cutting_plan_items(request_item_table, request_item_id);

create table public.long_stock_cutting_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.long_stock_cutting_plans(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot) = 'object'),
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{32}$'),
  settings_snapshot jsonb not null check (jsonb_typeof(settings_snapshot) = 'object'),
  selected_candidate_number integer not null check (selected_candidate_number > 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'invalid')),
  invalidation_reason text,
  invalidation_receipt_schedule_id uuid
    references public.supply_order_delivery_schedules(id) on delete restrict,
  manual_edit_reason text,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  approved_by uuid references public.users(id) on delete restrict,
  approved_at timestamptz,
  invalidated_by uuid references public.users(id) on delete restrict,
  invalidated_at timestamptz,
  pdf_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(pdf_metadata) = 'object'),
  definition_sealed boolean not null default false,
  unique (plan_id, version_number),
  unique (plan_id, input_fingerprint),
  unique (plan_id, id),
  check (
    status <> 'approved'
    or (approved_by is not null and approved_at is not null)
  ),
  check (
    status <> 'invalid'
    or (
      btrim(coalesce(invalidation_reason, '')) <> ''
      and invalidation_receipt_schedule_id is not null
      and invalidated_by is not null
      and invalidated_at is not null
    )
  )
);

create unique index long_stock_cutting_one_approved_version_idx
  on public.long_stock_cutting_plan_versions(plan_id)
  where status = 'approved';

create table public.long_stock_cutting_segments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  version_id uuid not null,
  plan_item_id uuid not null,
  segment_number integer not null check (segment_number > 0),
  required_length_mm numeric not null check (required_length_mm > 0),
  required_weight_kg numeric check (required_weight_kg is null or required_weight_kg >= 0),
  created_at timestamptz not null default now(),
  foreign key (plan_id, version_id)
    references public.long_stock_cutting_plan_versions(plan_id, id) on delete restrict,
  foreign key (plan_id, plan_item_id)
    references public.long_stock_cutting_plan_items(plan_id, id) on delete restrict,
  unique (version_id, segment_number),
  unique (version_id, id)
);

create table public.long_stock_cutting_candidates (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.long_stock_cutting_plan_versions(id) on delete restrict,
  candidate_number integer not null check (candidate_number > 0),
  purchased_length_mm numeric not null check (purchased_length_mm >= 0),
  net_parts_length_mm numeric not null check (net_parts_length_mm >= 0),
  kerf_loss_length_mm numeric not null check (kerf_loss_length_mm >= 0),
  end_trim_loss_length_mm numeric not null check (end_trim_loss_length_mm >= 0),
  business_scrap_length_mm numeric not null check (business_scrap_length_mm >= 0),
  purchased_weight_kg numeric not null check (purchased_weight_kg >= 0),
  net_parts_weight_kg numeric not null check (net_parts_weight_kg >= 0),
  kerf_loss_weight_kg numeric not null check (kerf_loss_weight_kg >= 0),
  end_trim_loss_weight_kg numeric not null check (end_trim_loss_weight_kg >= 0),
  business_scrap_weight_kg numeric not null check (business_scrap_weight_kg >= 0),
  uses_nonstandard_length boolean not null default false,
  is_complete boolean not null,
  created_at timestamptz not null default now(),
  unique (version_id, candidate_number),
  unique (version_id, id)
);

alter table public.long_stock_cutting_plan_versions
  add constraint long_stock_cutting_selected_candidate_fk
  foreign key (id, selected_candidate_number)
  references public.long_stock_cutting_candidates(version_id, candidate_number)
  deferrable initially deferred;

create table public.long_stock_cutting_candidate_bars (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  candidate_id uuid not null,
  bar_number integer not null check (bar_number > 0),
  stock_length_mm integer not null check (stock_length_mm > 0),
  length_group text not null check (length_group in ('standard', 'nonstandard')),
  status text not null default 'planned' check (status in ('planned', 'cut', 'cancelled')),
  cut_by uuid references public.users(id) on delete restrict,
  cut_at timestamptz,
  cancelled_by uuid references public.users(id) on delete restrict,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (version_id, candidate_id)
    references public.long_stock_cutting_candidates(version_id, id) on delete restrict,
  unique (candidate_id, bar_number),
  unique (version_id, id),
  unique (candidate_id, id),
  check ((status = 'cut') = (cut_at is not null)),
  check ((status = 'cut') = (cut_by is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check ((status = 'cancelled') = (cancelled_by is not null))
);

create index long_stock_cutting_bars_status_idx
  on public.long_stock_cutting_candidate_bars(version_id, status);

create table public.long_stock_cutting_bar_cuts (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  candidate_id uuid not null,
  bar_id uuid not null,
  segment_id uuid not null,
  cut_number integer not null check (cut_number > 0),
  cut_length_mm numeric not null check (cut_length_mm > 0),
  created_at timestamptz not null default now(),
  foreign key (version_id, candidate_id)
    references public.long_stock_cutting_candidates(version_id, id) on delete restrict,
  foreign key (candidate_id, bar_id)
    references public.long_stock_cutting_candidate_bars(candidate_id, id) on delete restrict,
  foreign key (version_id, segment_id)
    references public.long_stock_cutting_segments(version_id, id) on delete restrict,
  unique (bar_id, cut_number),
  unique (candidate_id, segment_id)
);

create table public.long_stock_cutting_business_scraps (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null unique references public.inventory(id) on delete restrict,
  version_id uuid not null,
  bar_id uuid not null,
  linked_by uuid not null references public.users(id) on delete restrict,
  linked_at timestamptz not null default now(),
  foreign key (version_id, bar_id)
    references public.long_stock_cutting_candidate_bars(version_id, id) on delete restrict,
  unique (version_id, bar_id)
);

create table public.long_stock_cutting_actual_losses (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  bar_id uuid not null,
  kerf_loss_length_mm numeric not null check (kerf_loss_length_mm >= 0),
  end_trim_loss_length_mm numeric not null check (end_trim_loss_length_mm >= 0),
  kerf_loss_weight_kg numeric not null check (kerf_loss_weight_kg >= 0),
  end_trim_loss_weight_kg numeric not null check (end_trim_loss_weight_kg >= 0),
  recorded_by uuid not null references public.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  foreign key (version_id, bar_id)
    references public.long_stock_cutting_candidate_bars(version_id, id) on delete restrict,
  unique (bar_id)
);

comment on table public.long_stock_cutting_actual_losses is
  'Analytical kerf and end-trim losses. Deliberately has no inventory relation and never creates scrap stock.';
comment on column public.long_stock_cutting_plan_versions.settings_snapshot is
  'Immutable copy returned by fn_get_long_stock_layout_settings_snapshot at version creation.';
comment on column public.long_stock_cutting_plan_versions.invalidation_receipt_schedule_id is
  'Link to the existing delivered supply_order_delivery_schedules receiving record.';

create or replace function public.fn_long_stock_layout_category_for_variant(p_material_variant_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_variant public.material_variants%rowtype;
begin
  select * into v_variant
  from public.material_variants
  where id = p_material_variant_id;

  if not found then
    raise exception 'Вариант материала не найден';
  end if;

  if v_variant.category = 'circle' then
    return 'circle';
  elsif v_variant.category = 'pipe' and v_variant.pipe_type <> 'wire' then
    return 'pipe';
  elsif v_variant.category = 'knives' and v_variant.knife_bevel_count = 1 then
    return 'knife_bevel_1';
  elsif v_variant.category = 'knives' and v_variant.knife_bevel_count = 2 then
    return 'knife_bevel_2';
  end if;

  raise exception 'Вариант материала не относится к длинномеру раскроя';
end;
$$;

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
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'Связь карты раскроя с позицией заявки неизменяема';
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
  end if;

  if v_request_id is null then
    raise exception 'Позиция заявки длинномера не найдена';
  end if;
  if v_material_variant_id is null then
    raise exception 'Для позиции заявки не выбран точный вариант материала';
  end if;

  select material_variant_id into v_plan_variant_id
  from public.long_stock_cutting_plans where id = new.plan_id;
  if v_plan_variant_id is distinct from v_material_variant_id then
    raise exception 'Позиции одного плана должны иметь одинаковый вариант материала';
  end if;

  new.request_id := v_request_id;
  return new;
end;
$$;

create trigger long_stock_cutting_plan_item_guard_trigger
before insert or update or delete on public.long_stock_cutting_plan_items
for each row execute function public.fn_long_stock_cutting_plan_item_guard();

create or replace function public.fn_long_stock_cutting_plan_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Карта раскроя неизменяема и не удаляется';
  end if;
  if current_setting('app.long_stock_cutting_plan_closure', true) <> '1' then
    raise exception 'Статус карты раскроя меняется только при закрытии всех хлыстов';
  end if;
  if new.id is distinct from old.id
    or new.plan_number is distinct from old.plan_number
    or new.material_variant_id is distinct from old.material_variant_id
    or new.layout_category_key is distinct from old.layout_category_key
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'Постоянные данные карты раскроя неизменяемы';
  end if;
  return new;
end;
$$;

create trigger long_stock_cutting_plan_guard_trigger
before update or delete on public.long_stock_cutting_plans
for each row execute function public.fn_long_stock_cutting_plan_guard();

create or replace function public.fn_long_stock_cutting_version_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if current_setting('app.long_stock_cutting_version_create', true) <> '1' then
      raise exception 'Версия карты раскроя создаётся только атомарным RPC';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Версия карты раскроя неизменяема';
  end if;
  if current_setting('app.long_stock_cutting_version_lifecycle', true) <> '1' then
    raise exception 'Версия карты раскроя неизменяема';
  end if;
  if new.id is distinct from old.id
    or new.plan_id is distinct from old.plan_id
    or new.version_number is distinct from old.version_number
    or new.input_snapshot is distinct from old.input_snapshot
    or new.input_fingerprint is distinct from old.input_fingerprint
    or new.settings_snapshot is distinct from old.settings_snapshot
    or new.selected_candidate_number is distinct from old.selected_candidate_number
    or new.manual_edit_reason is distinct from old.manual_edit_reason
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.pdf_metadata is distinct from old.pdf_metadata then
    raise exception 'Содержимое версии карты раскроя неизменяемо';
  end if;
  return new;
end;
$$;

create trigger long_stock_cutting_version_guard_trigger
before insert or update or delete on public.long_stock_cutting_plan_versions
for each row execute function public.fn_long_stock_cutting_version_guard();

create or replace function public.fn_long_stock_cutting_definition_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
  v_sealed boolean;
begin
  v_version_id := case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  select definition_sealed into v_sealed
  from public.long_stock_cutting_plan_versions where id = v_version_id;
  if coalesce(v_sealed, true) then
    raise exception 'Состав версии карты раскроя неизменяем';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger long_stock_cutting_segments_definition_guard
before insert or update or delete on public.long_stock_cutting_segments
for each row execute function public.fn_long_stock_cutting_definition_guard();
create trigger long_stock_cutting_candidates_definition_guard
before insert or update or delete on public.long_stock_cutting_candidates
for each row execute function public.fn_long_stock_cutting_definition_guard();
create trigger long_stock_cutting_bars_definition_guard
before insert or update or delete on public.long_stock_cutting_candidate_bars
for each row execute function public.fn_long_stock_cutting_definition_guard();
create trigger long_stock_cutting_cuts_definition_guard
before insert or update or delete on public.long_stock_cutting_bar_cuts
for each row execute function public.fn_long_stock_cutting_definition_guard();

create or replace function public.fn_assert_long_stock_cutting_bar_capacity(p_bar_id uuid)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_bar_length numeric;
  v_kerf numeric;
  v_end_trim numeric;
  v_cut_length numeric;
  v_cut_count integer;
begin
  select bar.stock_length_mm,
         (version.settings_snapshot->>'kerf_mm')::numeric,
         (version.settings_snapshot->>'end_trim_mm')::numeric
  into v_bar_length, v_kerf, v_end_trim
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_plan_versions version on version.id = bar.version_id
  where bar.id = p_bar_id;

  if not found then return; end if;

  select coalesce(sum(cut_length_mm), 0), count(*)::integer
  into v_cut_length, v_cut_count
  from public.long_stock_cutting_bar_cuts
  where bar_id = p_bar_id;

  if v_cut_length + v_cut_count * v_kerf + v_end_trim > v_bar_length then
    raise exception using
      errcode = '23514',
      message = format(
        'Переполнение хлыста: резы %s + пропил %s + торцовка %s > длина %s',
        v_cut_length, v_cut_count * v_kerf, v_end_trim, v_bar_length
      );
  end if;
end;
$$;

create or replace function public.fn_long_stock_cutting_bar_capacity_trigger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_bar_id uuid;
begin
  if tg_table_name = 'long_stock_cutting_candidate_bars' then
    v_bar_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_bar_id := case when tg_op = 'DELETE' then old.bar_id else new.bar_id end;
  end if;
  perform public.fn_assert_long_stock_cutting_bar_capacity(v_bar_id);
  return null;
end;
$$;

create constraint trigger long_stock_cutting_cut_capacity_trigger
after insert or update or delete on public.long_stock_cutting_bar_cuts
deferrable initially immediate
for each row execute function public.fn_long_stock_cutting_bar_capacity_trigger();
create constraint trigger long_stock_cutting_bar_capacity_trigger
after insert or update of stock_length_mm on public.long_stock_cutting_candidate_bars
deferrable initially immediate
for each row execute function public.fn_long_stock_cutting_bar_capacity_trigger();

create or replace function public.fn_long_stock_cutting_cut_matches_segment()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_required_length numeric;
begin
  select required_length_mm into v_required_length
  from public.long_stock_cutting_segments
  where version_id = new.version_id and id = new.segment_id;
  if v_required_length is distinct from new.cut_length_mm then
    raise exception 'Длина реза должна совпадать с длиной исходного отрезка';
  end if;
  return new;
end;
$$;

create trigger long_stock_cutting_cut_matches_segment_trigger
before insert or update on public.long_stock_cutting_bar_cuts
for each row execute function public.fn_long_stock_cutting_cut_matches_segment();

create or replace function public.fn_assert_long_stock_cutting_three_lengths()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_candidate_id uuid := coalesce(new.candidate_id, old.candidate_id);
  v_count integer;
begin
  select count(distinct stock_length_mm)::integer into v_count
  from public.long_stock_cutting_candidate_bars
  where candidate_id = v_candidate_id;
  if v_count > 3 then
    raise exception using
      errcode = '23514',
      message = 'В одном варианте допустимо максимум три разных закупаемых длины';
  end if;
  return null;
end;
$$;

create constraint trigger long_stock_cutting_three_lengths_trigger
after insert or update or delete on public.long_stock_cutting_candidate_bars
deferrable initially immediate
for each row execute function public.fn_assert_long_stock_cutting_three_lengths();

create or replace function public.fn_sync_long_stock_cutting_nonstandard_flag()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_candidate_id uuid := coalesce(new.candidate_id, old.candidate_id);
begin
  update public.long_stock_cutting_candidates candidate
  set uses_nonstandard_length = exists (
    select 1 from public.long_stock_cutting_candidate_bars bar
    where bar.candidate_id = v_candidate_id and bar.length_group = 'nonstandard'
  )
  where candidate.id = v_candidate_id;
  return null;
end;
$$;

create trigger long_stock_cutting_nonstandard_flag_trigger
after insert or update of length_group or delete on public.long_stock_cutting_candidate_bars
for each row execute function public.fn_sync_long_stock_cutting_nonstandard_flag();

create or replace function public.fn_assert_long_stock_cutting_business_scrap_length(
  p_inventory_id uuid,
  p_bar_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inventory_length numeric;
  v_bar_number integer;
  v_bar_length numeric;
  v_end_trim numeric;
  v_cut_length numeric;
  v_cut_count integer;
  v_kerf numeric;
  v_expected_length numeric;
begin
  select inventory.piece_length_mm
  into v_inventory_length
  from public.inventory inventory
  where inventory.id = p_inventory_id
  for share;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Деловой остаток не найден';
  end if;

  select bar.bar_number,
         bar.stock_length_mm,
         coalesce((version.settings_snapshot->>'end_trim_mm')::numeric, 0),
         coalesce(sum(cut.cut_length_mm), 0),
         count(cut.id)::integer,
         coalesce((version.settings_snapshot->>'kerf_mm')::numeric, 0)
  into v_bar_number, v_bar_length, v_end_trim, v_cut_length, v_cut_count, v_kerf
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_plan_versions version on version.id = bar.version_id
  left join public.long_stock_cutting_bar_cuts cut on cut.bar_id = bar.id
  where bar.id = p_bar_id
  group by bar.bar_number, bar.stock_length_mm, version.settings_snapshot;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Связанный хлыст не найден';
  end if;

  v_expected_length := v_bar_length
    - v_end_trim
    - v_cut_length
    - v_cut_count * v_kerf;

  if v_inventory_length is distinct from v_expected_length then
    raise exception using
      errcode = '23514',
      message = format(
        'Длина делового остатка %s мм не совпадает с расчётной для хлыста №%s: %s - %s - %s - %s × %s = %s мм',
        v_inventory_length,
        v_bar_number,
        v_bar_length,
        v_end_trim,
        v_cut_length,
        v_cut_count,
        v_kerf,
        v_expected_length
      );
  end if;
end;
$$;

create or replace function public.fn_long_stock_cutting_inventory_scrap_length_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bar_id uuid;
begin
  for v_bar_id in
    select link.bar_id
    from public.long_stock_cutting_business_scraps link
    where link.inventory_id = new.id
  loop
    perform public.fn_assert_long_stock_cutting_business_scrap_length(new.id, v_bar_id);
  end loop;
  return null;
end;
$$;

create constraint trigger long_stock_cutting_inventory_scrap_length_guard_trigger
after update of piece_length_mm on public.inventory
deferrable initially immediate
for each row
when (old.piece_length_mm is distinct from new.piece_length_mm)
execute function public.fn_long_stock_cutting_inventory_scrap_length_guard();

create or replace function public.fn_long_stock_cutting_scrap_link_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inventory public.inventory%rowtype;
  v_bar_status text;
  v_is_selected boolean;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'Связь делового остатка с картой раскроя неизменяема';
  end if;

  select * into v_inventory from public.inventory where id = new.inventory_id;
  if not found
    or not v_inventory.is_business_scrap
    or v_inventory.business_scrap_state not in ('future', 'available')
    or v_inventory.piece_length_mm is null
    or v_inventory.piece_length_mm <= 0 then
    raise exception 'Складская строка не является мерным деловым остатком';
  end if;

  select bar.status,
         version.selected_candidate_number = candidate.candidate_number
  into v_bar_status, v_is_selected
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
  join public.long_stock_cutting_plan_versions version on version.id = bar.version_id
  where bar.id = new.bar_id and bar.version_id = new.version_id;

  if v_bar_status is distinct from 'cut' or not coalesce(v_is_selected, false) then
    raise exception 'Деловой остаток связывается только с порезанным хлыстом выбранного варианта';
  end if;
  perform public.fn_assert_long_stock_cutting_business_scrap_length(
    new.inventory_id,
    new.bar_id
  );
  return new;
end;
$$;

create trigger long_stock_cutting_scrap_link_guard_trigger
before insert or update or delete on public.long_stock_cutting_business_scraps
for each row execute function public.fn_long_stock_cutting_scrap_link_guard();

create or replace function public.fn_long_stock_cutting_actual_loss_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'Фактические потери раскроя неизменяемы';
  end if;
  select status into v_status
  from public.long_stock_cutting_candidate_bars
  where id = new.bar_id and version_id = new.version_id;
  if v_status is distinct from 'cut' then
    raise exception 'Фактические потери записываются только для порезанного хлыста';
  end if;
  return new;
end;
$$;

create trigger long_stock_cutting_actual_loss_guard_trigger
before insert or update or delete on public.long_stock_cutting_actual_losses
for each row execute function public.fn_long_stock_cutting_actual_loss_guard();

create or replace function public.fn_create_long_stock_cutting_plan(
  p_material_variant_id uuid,
  p_request_items jsonb,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan_id uuid;
  v_category_key text;
  v_item jsonb;
  v_item_plan_id uuid;
  v_existing_plan_id uuid;
  v_unlinked_count integer := 0;
  v_existing_variant_id uuid;
begin
  if jsonb_typeof(p_request_items) <> 'array' or jsonb_array_length(p_request_items) = 0 then
    raise exception 'Нужна минимум одна позиция заявки';
  end if;
  v_category_key := public.fn_long_stock_layout_category_for_variant(p_material_variant_id);

  -- Serialize ordinary repeated creation attempts and keep the stable plan number.
  perform pg_advisory_xact_lock(hashtextextended(p_request_items::text, 0));
  for v_item in select value from jsonb_array_elements(p_request_items)
  loop
    v_item_plan_id := null;
    select item.plan_id into v_item_plan_id
    from public.long_stock_cutting_plan_items item
    where item.request_item_table = v_item->>'request_item_table'
      and item.request_item_id = (v_item->>'request_item_id')::uuid
    order by item.linked_at, item.id
    limit 1;
    if v_item_plan_id is null then
      v_unlinked_count := v_unlinked_count + 1;
    elsif v_existing_plan_id is null then
      v_existing_plan_id := v_item_plan_id;
    elsif v_existing_plan_id is distinct from v_item_plan_id then
      raise exception 'Позиции уже относятся к разным картам раскроя';
    end if;
  end loop;

  if v_existing_plan_id is not null then
    if v_unlinked_count > 0 then
      raise exception 'Объединение новых позиций в существующую карту будет реализовано отдельно';
    end if;
    select material_variant_id into v_existing_variant_id
    from public.long_stock_cutting_plans where id = v_existing_plan_id;
    if v_existing_variant_id is distinct from p_material_variant_id then
      raise exception 'Существующая карта использует другой вариант материала';
    end if;
    return v_existing_plan_id;
  end if;

  insert into public.long_stock_cutting_plans(
    material_variant_id, layout_category_key, created_by
  ) values (p_material_variant_id, v_category_key, p_created_by)
  returning id into v_plan_id;

  for v_item in select value from jsonb_array_elements(p_request_items)
  loop
    insert into public.long_stock_cutting_plan_items(
      plan_id, request_item_table, request_item_id, request_id, linked_by
    ) values (
      v_plan_id,
      v_item->>'request_item_table',
      (v_item->>'request_item_id')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      p_created_by
    );
  end loop;

  return v_plan_id;
end;
$$;

create or replace function public.fn_get_or_create_long_stock_cutting_plan_version(
  p_plan_id uuid,
  p_input_snapshot jsonb,
  p_segments jsonb,
  p_candidates jsonb,
  p_selected_candidate_number integer,
  p_created_by uuid,
  p_manual_edit_reason text default null,
  p_pdf_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.long_stock_cutting_plans%rowtype;
  v_settings_snapshot jsonb;
  v_fingerprint text;
  v_version_id uuid;
  v_version_number integer;
  v_existing record;
  v_segment jsonb;
  v_candidate jsonb;
  v_bar jsonb;
  v_cut jsonb;
  v_candidate_id uuid;
  v_bar_id uuid;
  v_segment_id uuid;
  v_candidate_number integer;
begin
  if jsonb_typeof(p_input_snapshot) <> 'object' then
    raise exception 'Входной snapshot должен быть JSON-объектом';
  end if;
  if jsonb_typeof(p_segments) <> 'array' or jsonb_array_length(p_segments) = 0 then
    raise exception 'Версия должна содержать хотя бы один отрезок';
  end if;
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) = 0 then
    raise exception 'Версия должна содержать хотя бы один кандидат';
  end if;
  if p_selected_candidate_number is null or p_selected_candidate_number <= 0 then
    raise exception 'Не выбран вариант раскроя';
  end if;
  if jsonb_typeof(p_pdf_metadata) <> 'object' then
    raise exception 'Метаданные PDF должны быть JSON-объектом';
  end if;

  select * into v_plan
  from public.long_stock_cutting_plans
  where id = p_plan_id
  for update;
  if not found then raise exception 'Карта раскроя не найдена'; end if;
  if v_plan.status = 'closed' then
    raise exception 'Закрытая карта раскроя не принимает новые версии';
  end if;

  v_settings_snapshot := public.fn_get_long_stock_layout_settings_snapshot();
  if v_settings_snapshot is null then
    raise exception 'Настройки раскладки хлыстов не найдены';
  end if;
  v_fingerprint := md5(jsonb_build_object(
    'input', p_input_snapshot,
    'settings', v_settings_snapshot
  )::text);

  select id, input_snapshot, settings_snapshot
  into v_existing
  from public.long_stock_cutting_plan_versions
  where plan_id = p_plan_id and input_fingerprint = v_fingerprint;
  if found then
    if v_existing.input_snapshot is distinct from p_input_snapshot
      or v_existing.settings_snapshot is distinct from v_settings_snapshot then
      raise exception 'Коллизия fingerprint входных данных карты раскроя';
    end if;
    return v_existing.id;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_version_number
  from public.long_stock_cutting_plan_versions where plan_id = p_plan_id;

  perform set_config('app.long_stock_cutting_version_create', '1', true);
  insert into public.long_stock_cutting_plan_versions(
    plan_id, version_number, input_snapshot, input_fingerprint, settings_snapshot,
    selected_candidate_number, manual_edit_reason, created_by, pdf_metadata
  ) values (
    p_plan_id, v_version_number, p_input_snapshot, v_fingerprint, v_settings_snapshot,
    p_selected_candidate_number, nullif(btrim(coalesce(p_manual_edit_reason, '')), ''),
    p_created_by, p_pdf_metadata
  ) returning id into v_version_id;
  perform set_config('app.long_stock_cutting_version_create', '', true);

  for v_segment in select value from jsonb_array_elements(p_segments)
  loop
    insert into public.long_stock_cutting_segments(
      plan_id, version_id, plan_item_id, segment_number,
      required_length_mm, required_weight_kg
    ) values (
      p_plan_id,
      v_version_id,
      (v_segment->>'plan_item_id')::uuid,
      (v_segment->>'segment_number')::integer,
      (v_segment->>'required_length_mm')::numeric,
      nullif(v_segment->>'required_weight_kg', '')::numeric
    );
  end loop;

  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    v_candidate_number := (v_candidate->>'candidate_number')::integer;
    insert into public.long_stock_cutting_candidates(
      version_id, candidate_number,
      purchased_length_mm, net_parts_length_mm,
      kerf_loss_length_mm, end_trim_loss_length_mm, business_scrap_length_mm,
      purchased_weight_kg, net_parts_weight_kg,
      kerf_loss_weight_kg, end_trim_loss_weight_kg, business_scrap_weight_kg,
      is_complete
    ) values (
      v_version_id,
      v_candidate_number,
      (v_candidate#>>'{metrics,purchased_length_mm}')::numeric,
      (v_candidate#>>'{metrics,net_parts_length_mm}')::numeric,
      (v_candidate#>>'{metrics,kerf_loss_length_mm}')::numeric,
      (v_candidate#>>'{metrics,end_trim_loss_length_mm}')::numeric,
      (v_candidate#>>'{metrics,business_scrap_length_mm}')::numeric,
      (v_candidate#>>'{metrics,purchased_weight_kg}')::numeric,
      (v_candidate#>>'{metrics,net_parts_weight_kg}')::numeric,
      (v_candidate#>>'{metrics,kerf_loss_weight_kg}')::numeric,
      (v_candidate#>>'{metrics,end_trim_loss_weight_kg}')::numeric,
      (v_candidate#>>'{metrics,business_scrap_weight_kg}')::numeric,
      (v_candidate->>'is_complete')::boolean
    ) returning id into v_candidate_id;

    if coalesce(jsonb_typeof(v_candidate->'bars'), 'null') <> 'array' then
      raise exception 'Хлысты кандидата должны быть JSON-массивом';
    end if;
    for v_bar in select value from jsonb_array_elements(v_candidate->'bars')
    loop
      insert into public.long_stock_cutting_candidate_bars(
        version_id, candidate_id, bar_number, stock_length_mm, length_group
      ) values (
        v_version_id,
        v_candidate_id,
        (v_bar->>'bar_number')::integer,
        (v_bar->>'stock_length_mm')::integer,
        v_bar->>'length_group'
      ) returning id into v_bar_id;

      if coalesce(jsonb_typeof(v_bar->'cuts'), 'null') <> 'array' then
        raise exception 'Резы хлыста должны быть JSON-массивом';
      end if;
      for v_cut in select value from jsonb_array_elements(v_bar->'cuts')
      loop
        select id into v_segment_id
        from public.long_stock_cutting_segments
        where version_id = v_version_id
          and segment_number = (v_cut->>'segment_number')::integer;
        if v_segment_id is null then
          raise exception 'Отрезок №% не найден в версии', v_cut->>'segment_number';
        end if;
        insert into public.long_stock_cutting_bar_cuts(
          version_id, candidate_id, bar_id, segment_id, cut_number, cut_length_mm
        ) values (
          v_version_id, v_candidate_id, v_bar_id, v_segment_id,
          (v_cut->>'cut_number')::integer,
          (v_cut->>'cut_length_mm')::numeric
        );
      end loop;
    end loop;
  end loop;

  if not exists (
    select 1 from public.long_stock_cutting_candidates
    where version_id = v_version_id and candidate_number = p_selected_candidate_number
  ) then
    raise exception 'Выбранный кандидат отсутствует в версии';
  end if;

  perform set_config('app.long_stock_cutting_version_lifecycle', '1', true);
  update public.long_stock_cutting_plan_versions
  set definition_sealed = true
  where id = v_version_id;
  perform set_config('app.long_stock_cutting_version_lifecycle', '', true);
  return v_version_id;
end;
$$;

create or replace function public.fn_set_long_stock_cutting_plan_version_status(
  p_version_id uuid,
  p_status text,
  p_actor uuid,
  p_invalidation_reason text default null,
  p_invalidation_receipt_schedule_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version public.long_stock_cutting_plan_versions%rowtype;
  v_receipt_status text;
  v_receipt_table text;
  v_receipt_item_id uuid;
begin
  if p_status not in ('approved', 'invalid') then
    raise exception 'Допустимые статусы версии: approved, invalid';
  end if;
  select * into v_version
  from public.long_stock_cutting_plan_versions
  where id = p_version_id for update;
  if not found then raise exception 'Версия карты раскроя не найдена'; end if;
  if v_version.status = p_status then return v_version.status; end if;
  if v_version.status = 'invalid' then
    raise exception 'Недействительную версию нельзя изменить';
  end if;

  if p_status = 'approved' then
    if v_version.status <> 'draft' then
      raise exception 'Утвердить можно только черновик версии';
    end if;
    if not exists (
      select 1
      from public.long_stock_cutting_candidates candidate
      where candidate.version_id = v_version.id
        and candidate.candidate_number = v_version.selected_candidate_number
        and candidate.is_complete
        and exists (
          select 1 from public.long_stock_cutting_candidate_bars bar
          where bar.candidate_id = candidate.id
        )
    ) then
      raise exception 'Выбранный вариант должен быть полным и содержать хлысты';
    end if;
    if exists (
      select 1
      from public.long_stock_cutting_segments segment
      where segment.version_id = v_version.id
        and not exists (
          select 1
          from public.long_stock_cutting_candidates candidate
          join public.long_stock_cutting_bar_cuts cut on cut.candidate_id = candidate.id
          where candidate.version_id = v_version.id
            and candidate.candidate_number = v_version.selected_candidate_number
            and cut.segment_id = segment.id
        )
    ) then
      raise exception 'Выбранный вариант не содержит все требуемые отрезки';
    end if;

    perform set_config('app.long_stock_cutting_version_lifecycle', '1', true);
    update public.long_stock_cutting_plan_versions
    set status = 'approved', approved_by = p_actor, approved_at = now()
    where id = p_version_id;
    perform set_config('app.long_stock_cutting_version_lifecycle', '', true);
  else
    if btrim(coalesce(p_invalidation_reason, '')) = ''
      or p_invalidation_receipt_schedule_id is null then
      raise exception 'Для недействительной версии нужны причина и документ приёмки';
    end if;
    select status, request_item_table, request_item_id
    into v_receipt_status, v_receipt_table, v_receipt_item_id
    from public.supply_order_delivery_schedules
    where id = p_invalidation_receipt_schedule_id;
    if v_receipt_status is distinct from 'delivered' then
      raise exception 'Документ приёмки должен ссылаться на принятую поставку';
    end if;
    if not exists (
      select 1 from public.long_stock_cutting_plan_items item
      where item.plan_id = v_version.plan_id
        and item.request_item_table = v_receipt_table
        and item.request_item_id = v_receipt_item_id
    ) then
      raise exception 'Документ приёмки не относится к позициям карты раскроя';
    end if;

    perform set_config('app.long_stock_cutting_version_lifecycle', '1', true);
    update public.long_stock_cutting_plan_versions
    set status = 'invalid',
        invalidation_reason = btrim(p_invalidation_reason),
        invalidation_receipt_schedule_id = p_invalidation_receipt_schedule_id,
        invalidated_by = p_actor,
        invalidated_at = now()
    where id = p_version_id;
    perform set_config('app.long_stock_cutting_version_lifecycle', '', true);
  end if;
  return p_status;
end;
$$;

create or replace function public.fn_refresh_long_stock_cutting_plan_status(p_version_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan_id uuid;
begin
  select version.plan_id into v_plan_id
  from public.long_stock_cutting_plan_versions version
  join public.long_stock_cutting_candidates candidate
    on candidate.version_id = version.id
   and candidate.candidate_number = version.selected_candidate_number
  where version.id = p_version_id
    and version.status = 'approved'
    and exists (
      select 1 from public.long_stock_cutting_candidate_bars bar
      where bar.candidate_id = candidate.id
    )
    and not exists (
      select 1 from public.long_stock_cutting_candidate_bars bar
      where bar.candidate_id = candidate.id and bar.status = 'planned'
    );
  if v_plan_id is null then return; end if;

  perform set_config('app.long_stock_cutting_plan_closure', '1', true);
  update public.long_stock_cutting_plans
  set status = 'closed', closed_at = coalesce(closed_at, now()), closed_by = coalesce(closed_by, p_actor)
  where id = v_plan_id and status = 'open';
  perform set_config('app.long_stock_cutting_plan_closure', '', true);
end;
$$;

create or replace function public.fn_set_long_stock_cutting_bar_status(
  p_bar_id uuid,
  p_status text,
  p_actor uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
  v_bar_status text;
  v_selected boolean;
  v_version_status text;
begin
  if p_status not in ('cut', 'cancelled') then
    raise exception 'Хлыст можно закрыть только как cut или cancelled';
  end if;
  select bar.version_id,
         bar.status,
         version.selected_candidate_number = candidate.candidate_number,
         version.status
  into v_version_id, v_bar_status, v_selected, v_version_status
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
  join public.long_stock_cutting_plan_versions version on version.id = bar.version_id
  where bar.id = p_bar_id
  for update of bar;
  if not found then raise exception 'Хлыст карты раскроя не найден'; end if;
  if not v_selected or v_version_status <> 'approved' then
    raise exception 'Закрывать можно только хлысты выбранного утверждённого варианта';
  end if;
  if v_bar_status = p_status then return v_bar_status; end if;
  if v_bar_status <> 'planned' then
    raise exception 'Закрытый хлыст нельзя перевести в другой статус';
  end if;

  perform set_config('app.long_stock_cutting_bar_fact', '1', true);
  update public.long_stock_cutting_candidate_bars
  set status = p_status,
      cut_by = case when p_status = 'cut' then p_actor else null end,
      cut_at = case when p_status = 'cut' then now() else null end,
      cancelled_by = case when p_status = 'cancelled' then p_actor else null end,
      cancelled_at = case when p_status = 'cancelled' then now() else null end
  where id = p_bar_id;
  perform set_config('app.long_stock_cutting_bar_fact', '', true);
  perform public.fn_refresh_long_stock_cutting_plan_status(v_version_id, p_actor);
  return p_status;
end;
$$;

create or replace function public.fn_long_stock_cutting_bar_fact_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.long_stock_cutting_bar_fact', true) <> '1' then
    raise exception 'Фактический статус хлыста меняется только через RPC';
  end if;
  if new.id is distinct from old.id
    or new.version_id is distinct from old.version_id
    or new.candidate_id is distinct from old.candidate_id
    or new.bar_number is distinct from old.bar_number
    or new.stock_length_mm is distinct from old.stock_length_mm
    or new.length_group is distinct from old.length_group
    or new.created_at is distinct from old.created_at then
    raise exception 'Состав хлыста утверждённой версии неизменяем';
  end if;
  return new;
end;
$$;

-- This trigger runs before the generic definition guard so operational status changes
-- can bypass only the immutable bar definition, never its dimensions or cut order.
drop trigger long_stock_cutting_bars_definition_guard on public.long_stock_cutting_candidate_bars;
create trigger long_stock_cutting_bar_fact_guard_trigger
before update on public.long_stock_cutting_candidate_bars
for each row execute function public.fn_long_stock_cutting_bar_fact_guard();
create trigger long_stock_cutting_bars_insert_delete_guard
before insert or delete on public.long_stock_cutting_candidate_bars
for each row execute function public.fn_long_stock_cutting_definition_guard();

alter table public.long_stock_cutting_plans enable row level security;
alter table public.long_stock_cutting_plan_items enable row level security;
alter table public.long_stock_cutting_plan_versions enable row level security;
alter table public.long_stock_cutting_segments enable row level security;
alter table public.long_stock_cutting_candidates enable row level security;
alter table public.long_stock_cutting_candidate_bars enable row level security;
alter table public.long_stock_cutting_bar_cuts enable row level security;
alter table public.long_stock_cutting_business_scraps enable row level security;
alter table public.long_stock_cutting_actual_losses enable row level security;

revoke all on table public.long_stock_cutting_plans from public, anon, authenticated;
revoke all on table public.long_stock_cutting_plan_items from public, anon, authenticated;
revoke all on table public.long_stock_cutting_plan_versions from public, anon, authenticated;
revoke all on table public.long_stock_cutting_segments from public, anon, authenticated;
revoke all on table public.long_stock_cutting_candidates from public, anon, authenticated;
revoke all on table public.long_stock_cutting_candidate_bars from public, anon, authenticated;
revoke all on table public.long_stock_cutting_bar_cuts from public, anon, authenticated;
revoke all on table public.long_stock_cutting_business_scraps from public, anon, authenticated;
revoke all on table public.long_stock_cutting_actual_losses from public, anon, authenticated;
grant select on table public.long_stock_cutting_plans to service_role;
grant select on table public.long_stock_cutting_plan_items to service_role;
grant select on table public.long_stock_cutting_plan_versions to service_role;
grant select on table public.long_stock_cutting_segments to service_role;
grant select on table public.long_stock_cutting_candidates to service_role;
grant select on table public.long_stock_cutting_candidate_bars to service_role;
grant select on table public.long_stock_cutting_bar_cuts to service_role;
grant select, insert on table public.long_stock_cutting_business_scraps to service_role;
grant select, insert on table public.long_stock_cutting_actual_losses to service_role;

revoke all on function public.fn_long_stock_layout_category_for_variant(uuid)
  from public, anon, authenticated;
revoke all on function public.fn_long_stock_cutting_plan_item_guard()
  from public, anon, authenticated;
revoke all on function public.fn_long_stock_cutting_plan_guard()
  from public, anon, authenticated;
revoke all on function public.fn_long_stock_cutting_version_guard()
  from public, anon, authenticated;
revoke all on function public.fn_long_stock_cutting_definition_guard()
  from public, anon, authenticated;
revoke all on function public.fn_assert_long_stock_cutting_bar_capacity(uuid)
  from public, anon, authenticated;
revoke all on function public.fn_long_stock_cutting_bar_capacity_trigger()
  from public, anon, authenticated;
revoke all on function public.fn_long_stock_cutting_cut_matches_segment()
  from public, anon, authenticated;
revoke all on function public.fn_assert_long_stock_cutting_three_lengths()
  from public, anon, authenticated;
revoke all on function public.fn_sync_long_stock_cutting_nonstandard_flag()
  from public, anon, authenticated;
revoke all on function public.fn_assert_long_stock_cutting_business_scrap_length(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fn_long_stock_cutting_inventory_scrap_length_guard()
  from public, anon, authenticated;
revoke all on function public.fn_long_stock_cutting_scrap_link_guard()
  from public, anon, authenticated;
revoke all on function public.fn_long_stock_cutting_actual_loss_guard()
  from public, anon, authenticated;
revoke all on function public.fn_refresh_long_stock_cutting_plan_status(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fn_long_stock_cutting_bar_fact_guard()
  from public, anon, authenticated;

revoke all on function public.fn_create_long_stock_cutting_plan(uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.fn_get_or_create_long_stock_cutting_plan_version(uuid, jsonb, jsonb, jsonb, integer, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.fn_set_long_stock_cutting_plan_version_status(uuid, text, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.fn_set_long_stock_cutting_bar_status(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_create_long_stock_cutting_plan(uuid, jsonb, uuid) to service_role;
grant execute on function public.fn_get_or_create_long_stock_cutting_plan_version(uuid, jsonb, jsonb, jsonb, integer, uuid, text, jsonb)
  to service_role;
grant execute on function public.fn_set_long_stock_cutting_plan_version_status(uuid, text, uuid, text, uuid)
  to service_role;
grant execute on function public.fn_set_long_stock_cutting_bar_status(uuid, text, uuid) to service_role;
