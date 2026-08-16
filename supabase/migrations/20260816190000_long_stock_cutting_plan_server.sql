-- Transactional server layer for long-stock cutting plans.
-- UI, purchasing, receiving and production-fact integration remain out of scope.

alter table public.long_stock_cutting_plan_items
  add column cutting_status text not null default 'planning'
  check (cutting_status in ('planning', 'plan_approved', 'accepted'));

alter table public.long_stock_cutting_candidate_bars
  add column source_type text not null default 'new_stock',
  add column source_inventory_id uuid references public.inventory(id) on delete restrict;

alter table public.long_stock_cutting_candidate_bars
  alter column length_group drop not null;

alter table public.long_stock_cutting_candidate_bars
  add constraint long_stock_cutting_bar_source_check check (
    (
      source_type = 'new_stock'
      and source_inventory_id is null
      and length_group in ('standard', 'nonstandard')
    )
    or (
      source_type = 'business_remnant'
      and source_inventory_id is not null
      and length_group is null
    )
  );

create unique index long_stock_cutting_candidate_source_inventory_idx
  on public.long_stock_cutting_candidate_bars(candidate_id, source_inventory_id)
  where source_type = 'business_remnant';

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

  if tg_op = 'UPDATE' then
    if current_setting('app.long_stock_cutting_item_status', true) <> '1' then
      raise exception 'Статус позиции карты раскроя меняется только атомарным RPC';
    end if;
    if new.id is distinct from old.id
      or new.plan_id is distinct from old.plan_id
      or new.request_item_table is distinct from old.request_item_table
      or new.request_item_id is distinct from old.request_item_id
      or new.request_id is distinct from old.request_id
      or new.linked_by is distinct from old.linked_by
      or new.linked_at is distinct from old.linked_at then
      raise exception 'Связь карты раскроя с позицией заявки неизменяема';
    end if;
    if old.cutting_status <> 'planning'
      and new.cutting_status is distinct from old.cutting_status then
      raise exception 'Установленный статус позиции карты раскроя неизменяем';
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

create or replace function public.fn_assert_long_stock_cutting_bar_capacity(p_bar_id uuid)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_bar_number integer;
  v_bar_length numeric;
  v_kerf numeric;
  v_end_trim numeric;
  v_cut_length numeric;
  v_cut_count integer;
  v_used_length numeric;
begin
  select bar.bar_number,
         bar.stock_length_mm,
         (version.settings_snapshot->>'kerf_mm')::numeric,
         (version.settings_snapshot->>'end_trim_mm')::numeric
  into v_bar_number, v_bar_length, v_kerf, v_end_trim
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_plan_versions version on version.id = bar.version_id
  where bar.id = p_bar_id;

  if not found then return; end if;

  select coalesce(sum(cut_length_mm), 0), count(*)::integer
  into v_cut_length, v_cut_count
  from public.long_stock_cutting_bar_cuts
  where bar_id = p_bar_id;

  v_used_length := v_cut_length + v_cut_count * v_kerf + v_end_trim;
  if v_used_length > v_bar_length then
    raise exception using
      errcode = '23514',
      message = format(
        'Переполнение хлыста №%s: превышение %s мм',
        v_bar_number,
        v_used_length - v_bar_length
      );
  end if;
end;
$$;

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
  where candidate_id = v_candidate_id
    and source_type = 'new_stock';
  if v_count > 3 then
    raise exception using
      errcode = '23514',
      message = 'В одном варианте допустимо максимум три разных закупаемых длины';
  end if;
  return null;
end;
$$;

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
    where bar.candidate_id = v_candidate_id
      and bar.source_type = 'new_stock'
      and bar.length_group = 'nonstandard'
  )
  where candidate.id = v_candidate_id;
  return null;
end;
$$;

create or replace function public.fn_validate_long_stock_cutting_candidate(p_candidate_id uuid)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_candidate public.long_stock_cutting_candidates%rowtype;
  v_missing_segments text;
  v_bar record;
begin
  select * into v_candidate
  from public.long_stock_cutting_candidates
  where id = p_candidate_id;
  if not found then raise exception 'Кандидат раскроя не найден'; end if;

  for v_bar in
    select bar.id, bar.bar_number, bar.stock_length_mm,
           max(cut.cut_length_mm) as longest_cut
    from public.long_stock_cutting_candidate_bars bar
    left join public.long_stock_cutting_bar_cuts cut on cut.bar_id = bar.id
    where bar.candidate_id = p_candidate_id
    group by bar.id, bar.bar_number, bar.stock_length_mm
    order by bar.bar_number
  loop
    if v_bar.longest_cut > v_bar.stock_length_mm then
      raise exception using
        errcode = '23514',
        message = format(
          'Хлыст №%s: заготовка длиннее хлыста на %s мм',
          v_bar.bar_number,
          v_bar.longest_cut - v_bar.stock_length_mm
        );
    end if;
    perform public.fn_assert_long_stock_cutting_bar_capacity(v_bar.id);
  end loop;

  select string_agg(segment.segment_number::text, ', ' order by segment.segment_number)
  into v_missing_segments
  from public.long_stock_cutting_segments segment
  where segment.version_id = v_candidate.version_id
    and not exists (
      select 1
      from public.long_stock_cutting_bar_cuts cut
      where cut.candidate_id = p_candidate_id
        and cut.segment_id = segment.id
    );
  if v_missing_segments is not null then
    raise exception using
      errcode = '23514',
      message = format('Потеряны заготовки №%s', v_missing_segments);
  end if;
end;
$$;

create or replace function public.fn_long_stock_cutting_scrap_link_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inventory public.inventory%rowtype;
  v_bar_status text;
  v_version_status text;
  v_is_selected boolean;
  v_plan_variant_id uuid;
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
         version.status,
         version.selected_candidate_number = candidate.candidate_number,
         plan.material_variant_id
  into v_bar_status, v_version_status, v_is_selected, v_plan_variant_id
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
  join public.long_stock_cutting_plan_versions version on version.id = bar.version_id
  join public.long_stock_cutting_plans plan on plan.id = version.plan_id
  where bar.id = new.bar_id and bar.version_id = new.version_id;

  if v_version_status is distinct from 'approved'
    or v_bar_status not in ('planned', 'cut')
    or not coalesce(v_is_selected, false) then
    raise exception 'Деловой остаток связывается только с утверждённым выбранным вариантом';
  end if;
  if v_inventory.material_variant_id is distinct from v_plan_variant_id then
    raise exception 'Деловой остаток использует другой вариант материала';
  end if;
  return new;
end;
$$;

create or replace function public.fn_get_or_create_long_stock_cutting_plan_version_v2(
  p_plan_id uuid,
  p_input_snapshot jsonb,
  p_settings_snapshot jsonb,
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
  if jsonb_typeof(p_settings_snapshot) <> 'object' then
    raise exception 'Snapshot настроек должен быть JSON-объектом';
  end if;
  if coalesce((p_settings_snapshot->>'kerf_mm')::numeric, -1) < 0
    or coalesce((p_settings_snapshot->>'end_trim_mm')::numeric, -1) < 0 then
    raise exception 'Snapshot настроек раскроя повреждён';
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

  v_fingerprint := md5(jsonb_build_object(
    'input', p_input_snapshot,
    'settings', p_settings_snapshot
  )::text);
  select id, input_snapshot, settings_snapshot
  into v_existing
  from public.long_stock_cutting_plan_versions
  where plan_id = p_plan_id and input_fingerprint = v_fingerprint;
  if found then
    if v_existing.input_snapshot is distinct from p_input_snapshot
      or v_existing.settings_snapshot is distinct from p_settings_snapshot then
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
    p_plan_id, v_version_number, p_input_snapshot, v_fingerprint, p_settings_snapshot,
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
        version_id, candidate_id, bar_number, stock_length_mm, length_group,
        source_type, source_inventory_id
      ) values (
        v_version_id,
        v_candidate_id,
        (v_bar->>'bar_number')::integer,
        (v_bar->>'stock_length_mm')::integer,
        nullif(v_bar->>'length_group', ''),
        coalesce(nullif(v_bar->>'source_type', ''), 'new_stock'),
        nullif(v_bar->>'source_inventory_id', '')::uuid
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
    perform public.fn_validate_long_stock_cutting_candidate(v_candidate_id);
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

create or replace function public.fn_approve_long_stock_cutting_plan_version_v1(
  p_version_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version public.long_stock_cutting_plan_versions%rowtype;
  v_plan public.long_stock_cutting_plans%rowtype;
  v_candidate public.long_stock_cutting_candidates%rowtype;
  v_plan_item public.long_stock_cutting_plan_items%rowtype;
  v_machine_id uuid;
  v_factory_id uuid;
  v_stage_id uuid;
  v_stage_date date;
  v_material_id uuid;
  v_default_unit text;
  v_weight_per_m numeric;
  v_minimum_useful_length numeric;
  v_item_status text;
  v_bar record;
  v_source public.inventory%rowtype;
  v_reservation_id uuid;
  v_scrap_inventory_id uuid;
  v_future_scrap_ids uuid[] := '{}'::uuid[];
  v_cut_length numeric;
  v_cut_count integer;
  v_remainder numeric;
  v_logical_quantity numeric;
begin
  select * into v_version
  from public.long_stock_cutting_plan_versions
  where id = p_version_id
  for update;
  if not found then raise exception 'Версия карты раскроя не найдена'; end if;

  select * into v_plan
  from public.long_stock_cutting_plans
  where id = v_version.plan_id
  for update;

  if v_version.status = 'approved' then
    select coalesce(array_agg(link.inventory_id order by link.linked_at), '{}'::uuid[])
    into v_future_scrap_ids
    from public.long_stock_cutting_business_scraps link
    where link.version_id = v_version.id;
    select cutting_status into v_item_status
    from public.long_stock_cutting_plan_items
    where plan_id = v_plan.id
    order by linked_at, id
    limit 1;
    return jsonb_build_object(
      'version_id', v_version.id,
      'status', v_version.status,
      'position_status', v_item_status,
      'future_scrap_inventory_ids', to_jsonb(v_future_scrap_ids)
    );
  end if;
  if v_version.status <> 'draft' then
    raise exception 'Утвердить можно только черновик версии';
  end if;

  select * into v_candidate
  from public.long_stock_cutting_candidates
  where version_id = v_version.id
    and candidate_number = v_version.selected_candidate_number
  for update;
  if not found or not v_candidate.is_complete then
    raise exception 'Выбранный вариант должен быть полным';
  end if;
  perform public.fn_validate_long_stock_cutting_candidate(v_candidate.id);

  select * into v_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_plan.id
  order by linked_at, id
  limit 1
  for update;
  if not found then raise exception 'Позиция карты раскроя не найдена'; end if;
  if (select count(*) from public.long_stock_cutting_plan_items where plan_id = v_plan.id) <> 1 then
    raise exception 'Серверный слой текущей версии рассчитывает одну позицию за раз';
  end if;

  select request.machine_id, machine.factory_id
  into v_machine_id, v_factory_id
  from public.technologist_requests request
  join public.machines machine on machine.id = request.machine_id
  where request.id = v_plan_item.request_id;
  if v_machine_id is null or v_factory_id is null then
    raise exception 'Для позиции не найдены машина и завод';
  end if;

  select variant.material_id, coalesce(variant.default_unit, 'мм'), variant.weight_per_m_kg
  into v_material_id, v_default_unit, v_weight_per_m
  from public.material_variants variant
  where variant.id = v_plan.material_variant_id;
  if v_material_id is null then raise exception 'Вариант материала карты раскроя не найден'; end if;

  select (category->>'minimum_useful_length_mm')::numeric
  into v_minimum_useful_length
  from jsonb_array_elements(v_version.settings_snapshot->'categories') category
  where category->>'key' = v_plan.layout_category_key;
  v_minimum_useful_length := coalesce(v_minimum_useful_length, 0);

  select stage.id, stage.date_start
  into v_stage_id, v_stage_date
  from public.production_stages stage
  where stage.machine_id = v_machine_id
    and stage.stage_type = 'cutting'::public.stage_type
  order by stage.created_at, stage.id
  limit 1
  for update;
  if v_stage_id is null then
    insert into public.production_stages(machine_id, stage_type, workshop, updated_by)
    values (v_machine_id, 'cutting'::public.stage_type, 1, p_actor)
    returning id, date_start into v_stage_id, v_stage_date;
  end if;

  perform set_config('app.long_stock_cutting_version_lifecycle', '1', true);
  update public.long_stock_cutting_plan_versions
  set status = 'approved', approved_by = p_actor, approved_at = now()
  where id = v_version.id;
  perform set_config('app.long_stock_cutting_version_lifecycle', '', true);

  for v_bar in
    select bar.*
    from public.long_stock_cutting_candidate_bars bar
    where bar.candidate_id = v_candidate.id
    order by bar.bar_number
  loop
    select coalesce(sum(cut.cut_length_mm), 0), count(*)::integer
    into v_cut_length, v_cut_count
    from public.long_stock_cutting_bar_cuts cut
    where cut.bar_id = v_bar.id;
    v_logical_quantity := v_cut_length
      + v_cut_count * (v_version.settings_snapshot->>'kerf_mm')::numeric
      + (v_version.settings_snapshot->>'end_trim_mm')::numeric;
    v_remainder := v_bar.stock_length_mm - v_logical_quantity;
    if v_remainder < 0 then
      raise exception 'Переполнение хлыста №%: превышение % мм', v_bar.bar_number, -v_remainder;
    end if;

    v_reservation_id := null;
    v_source := null;
    if v_bar.source_type = 'business_remnant' then
      select * into v_source
      from public.inventory
      where id = v_bar.source_inventory_id
      for update;
      if not found
        or v_source.deleted_at is not null
        or not v_source.is_business_scrap
        or v_source.business_scrap_state is distinct from 'available'
        or v_source.material_id is distinct from v_material_id
        or v_source.material_variant_id is distinct from v_plan.material_variant_id
        or v_source.piece_length_mm is distinct from v_bar.stock_length_mm then
        raise exception 'Хлыст №%: выбранный деловой остаток больше недоступен', v_bar.bar_number;
      end if;
      if v_source.available_quantity < v_bar.stock_length_mm
        or floor(coalesce(v_source.available_secondary_quantity, 0)) < 1 then
        raise exception 'Хлыст №%: выбранный деловой остаток уже зарезервирован', v_bar.bar_number;
      end if;

      insert into public.inventory_reservations(
        inventory_id, source_inventory_id, material_id, material_variant_id,
        machine_id, request_item_table, request_item_id,
        reserved_quantity, logical_reserved_quantity, reserved_secondary_quantity,
        reserved_by, original_piece_length_mm, is_cut_reservation, reservation_source
      ) values (
        v_source.id, v_source.id, v_source.material_id, v_source.material_variant_id,
        v_machine_id, v_plan_item.request_item_table, v_plan_item.request_item_id,
        v_bar.stock_length_mm, v_logical_quantity, 1,
        p_actor, v_bar.stock_length_mm, false, 'stock'
      ) returning id into v_reservation_id;

      update public.inventory
      set reserved_quantity = reserved_quantity + v_bar.stock_length_mm,
          reserved_secondary_quantity = coalesce(reserved_secondary_quantity, 0) + 1,
          last_updated_by = p_actor,
          updated_at = now()
      where id = v_source.id;

      insert into public.inventory_transactions(
        factory_id, inventory_id, material_id, material_variant_id,
        transaction_type, quantity, secondary_quantity,
        machine_id, request_item_table, request_item_id, performed_by, comment
      ) values (
        v_source.factory_id, v_source.id, v_source.material_id, v_source.material_variant_id,
        'reserve', -v_bar.stock_length_mm, -1,
        v_machine_id, v_plan_item.request_item_table, v_plan_item.request_item_id,
        p_actor, 'Резерв делового остатка по утверждённой карте раскроя'
      );

      if v_source.factory_id is distinct from v_factory_id then
        perform public.inventory_attach_reservation_to_transfer(
          v_reservation_id, v_factory_id, p_actor
        );
      end if;
    end if;

    if v_remainder > 0 and v_remainder >= v_minimum_useful_length then
      insert into public.inventory(
        factory_id, material_id, material_variant_id, piece_length_mm,
        total_quantity, reserved_quantity, unit,
        total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
        calculated_weight_kg,
        is_business_scrap, business_scrap_state,
        available_from_date, available_from_stage_id,
        source_inventory_id, source_reservation_id, source_machine_id,
        source_piece_length_mm, last_updated_by
      ) values (
        v_factory_id, v_material_id, v_plan.material_variant_id, v_remainder,
        v_remainder, 0, v_default_unit,
        1, 0, 'шт',
        case when v_weight_per_m is null then null else v_remainder * v_weight_per_m / 1000 end,
        true, 'future',
        v_stage_date, v_stage_id,
        case when v_bar.source_type = 'business_remnant' then v_bar.source_inventory_id else null end,
        v_reservation_id, v_machine_id,
        v_bar.stock_length_mm, p_actor
      ) returning id into v_scrap_inventory_id;

      if v_reservation_id is not null then
        update public.inventory_reservations
        set business_scrap_inventory_id = v_scrap_inventory_id,
            business_scrap_quantity = v_remainder
        where id = v_reservation_id;
      end if;

      insert into public.long_stock_cutting_business_scraps(
        inventory_id, version_id, bar_id, linked_by
      ) values (v_scrap_inventory_id, v_version.id, v_bar.id, p_actor);
      v_future_scrap_ids := array_append(v_future_scrap_ids, v_scrap_inventory_id);
    end if;
  end loop;

  perform public.fn_set_request_reserved_quantity(
    v_plan_item.request_item_table,
    v_plan_item.request_item_id
  );
  v_item_status := case
    when v_candidate.purchased_length_mm = 0 then 'accepted'
    else 'plan_approved'
  end;
  perform set_config('app.long_stock_cutting_item_status', '1', true);
  update public.long_stock_cutting_plan_items
  set cutting_status = v_item_status
  where plan_id = v_plan.id;
  perform set_config('app.long_stock_cutting_item_status', '', true);

  return jsonb_build_object(
    'version_id', v_version.id,
    'status', 'approved',
    'position_status', v_item_status,
    'purchase_required', v_candidate.purchased_length_mm > 0,
    'future_scrap_inventory_ids', to_jsonb(v_future_scrap_ids)
  );
end;
$$;

revoke all on function public.fn_validate_long_stock_cutting_candidate(uuid)
  from public, anon, authenticated;
revoke all on function public.fn_get_or_create_long_stock_cutting_plan_version_v2(
  uuid, jsonb, jsonb, jsonb, jsonb, integer, uuid, text, jsonb
) from public, anon, authenticated;
revoke all on function public.fn_approve_long_stock_cutting_plan_version_v1(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.fn_get_or_create_long_stock_cutting_plan_version_v2(
  uuid, jsonb, jsonb, jsonb, jsonb, integer, uuid, text, jsonb
) to service_role;
grant execute on function public.fn_approve_long_stock_cutting_plan_version_v1(uuid, uuid)
  to service_role;
