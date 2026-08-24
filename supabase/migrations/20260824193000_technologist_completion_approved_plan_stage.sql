-- Keep the technologist completion at the planning/supply boundary.
-- Physical long-stock cutting facts are recorded later by the production
-- cutting event and must not block an approved request from reaching supply.

create or replace function public.fn_finalize_technologist_request(
  p_request_id uuid,
  p_actor uuid,
  p_decision text,
  p_entered_plasma_minutes integer,
  p_waste_items jsonb,
  p_future_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.technologist_requests%rowtype;
  v_machine public.machines%rowtype;
  v_completion uuid;
  v_batch uuid;
  v_item jsonb;
  v_weight numeric;
  v_pct numeric;
  v_part uuid;
  v_lot uuid;
  v_now timestamptz := now();
  v_detailing_check jsonb;
  v_plan_fact record;
  v_plan_count integer;
  v_manual_count integer;
  v_payload_count integer;
begin
  if p_actor is null or p_actor <> auth.uid() then raise exception 'Недостаточно прав'; end if;
  if p_decision not in ('has_items', 'none') or p_entered_plasma_minutes < 0 then
    raise exception 'Некорректные данные завершения';
  end if;
  if jsonb_typeof(coalesce(p_waste_items, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_future_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Некорректные данные позиций завершения';
  end if;

  select * into v_request
  from public.technologist_requests
  where id = p_request_id
  for update;
  if not found or v_request.created_by <> p_actor then raise exception 'Заявка недоступна'; end if;
  if v_request.status not in ('pending_stock_check', 'stock_checked') then raise exception 'Заявка уже завершена'; end if;

  select * into v_machine from public.machines where id = v_request.machine_id;
  if v_machine.factory_id is null then raise exception 'У машины не указан завод'; end if;

  if p_entered_plasma_minutes > 0 and not exists (
    select 1
    from public.request_sheet_metal sheet
    where sheet.request_id = p_request_id
  ) then
    raise exception 'Время плазмы доступно только для заявок с листовым металлом';
  end if;

  v_detailing_check := public.fn_validate_detailing_request_check(p_request_id, p_actor);
  if coalesce((v_detailing_check->>'ready')::boolean, false) = false then
    raise exception '%', coalesce(v_detailing_check->>'message', 'Проверьте бронь деталировки');
  end if;
  if exists (
    select 1 from public.technologist_request_completions where request_id = p_request_id
  ) then
    raise exception 'Заявка уже зафиксирована';
  end if;

  if p_decision = 'has_items' and jsonb_array_length(coalesce(p_future_items, '[]'::jsonb)) = 0 then
    raise exception 'Добавьте будущую деталировку';
  end if;
  if p_decision = 'none' and jsonb_array_length(coalesce(p_future_items, '[]'::jsonb)) > 0 then
    raise exception 'Решение не соответствует деталировке';
  end if;

  -- Lock the exact plan/fact rows used for the completion snapshot. A rollback
  -- or inventory rewrite must wait until this finalization transaction ends.
  perform 1
  from public.long_stock_cutting_plan_items item
  join public.long_stock_cutting_plans plan on plan.id = item.plan_id
  where item.request_id = p_request_id
  for update of item, plan;
  perform 1
  from public.long_stock_cutting_plan_versions version
  join public.long_stock_cutting_plan_items item on item.plan_id = version.plan_id
  where item.request_id = p_request_id
  for update of version;
  perform 1
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_plan_versions version on version.id = bar.version_id
  join public.long_stock_cutting_plan_items item on item.plan_id = version.plan_id
  where item.request_id = p_request_id
  for update of bar;
  perform 1
  from public.long_stock_cutting_fact_bars fact_bar
  join public.long_stock_cutting_plan_versions version on version.id = fact_bar.version_id
  join public.long_stock_cutting_plan_items item on item.plan_id = version.plan_id
  where item.request_id = p_request_id
    and fact_bar.rolled_back_at is null
  for update of fact_bar;
  perform 1
  from public.long_stock_cutting_actual_losses loss
  join public.long_stock_cutting_plan_versions version on version.id = loss.version_id
  join public.long_stock_cutting_plan_items item on item.plan_id = version.plan_id
  where item.request_id = p_request_id
  for update of loss;

  select count(*) into v_plan_count
  from public.long_stock_cutting_plan_items item
  where item.request_id = p_request_id;

  with metallic_items as (
    select 'request_sheet_metal'::text as source_table, sheet.id as source_id
    from public.request_sheet_metal sheet where sheet.request_id = p_request_id
    union all
    select 'request_pipe', pipe.id from public.request_pipe pipe where pipe.request_id = p_request_id
    union all
    select 'request_circle', circle.id from public.request_circle circle where circle.request_id = p_request_id
    union all
    select 'request_knives', knife.id from public.request_knives knife where knife.request_id = p_request_id
  )
  select count(*) into v_manual_count
  from metallic_items item
  where not exists (
    select 1
    from public.long_stock_cutting_plan_items plan_item
    where plan_item.request_id = p_request_id
      and plan_item.request_item_table = item.source_table
      and plan_item.request_item_id = item.source_id
  );

  v_payload_count := jsonb_array_length(coalesce(p_waste_items, '[]'::jsonb));
  if v_payload_count = 0 and v_plan_count = 0 then
    raise exception 'Укажите отходность металлических позиций';
  end if;
  if v_payload_count <> v_manual_count then
    raise exception 'Укажите отходность только для обычных металлических позиций без карты раскроя';
  end if;
  if exists (
    with metallic_items as (
      select 'request_sheet_metal'::text as source_table, sheet.id as source_id
      from public.request_sheet_metal sheet where sheet.request_id = p_request_id
      union all
      select 'request_pipe', pipe.id from public.request_pipe pipe where pipe.request_id = p_request_id
      union all
      select 'request_circle', circle.id from public.request_circle circle where circle.request_id = p_request_id
      union all
      select 'request_knives', knife.id from public.request_knives knife where knife.request_id = p_request_id
    ), expected_items as (
      select item.source_table, item.source_id
      from metallic_items item
      where not exists (
        select 1
        from public.long_stock_cutting_plan_items plan_item
        where plan_item.request_id = p_request_id
          and plan_item.request_item_table = item.source_table
          and plan_item.request_item_id = item.source_id
      )
    ), payload_items as (
      select distinct
        payload->>'sourceTable' as source_table,
        (payload->>'sourceId')::uuid as source_id
      from jsonb_array_elements(coalesce(p_waste_items, '[]'::jsonb)) payload
      where payload->>'sourceTable' in (
        'request_sheet_metal', 'request_pipe', 'request_circle', 'request_knives'
      )
    ), differences as (
      (select * from expected_items except select * from payload_items)
      union all
      (select * from payload_items except select * from expected_items)
    )
    select 1 from differences
  ) then
    raise exception 'Список обычных металлических позиций не соответствует заявке';
  end if;

  -- Supply handoff belongs to the planning stage. Require a concrete approved
  -- cutting map, but do not wait for production facts that can only exist after
  -- supply and physical cutting. If legacy data already contains facts, keep
  -- the strict reconciliation guard for that completed fact set.
  for v_plan_fact in
    select * from public.fn_get_long_stock_completion_plan_facts_v1(p_request_id)
  loop
    if v_plan_fact.version_id is null
       or v_plan_fact.plan_status not in ('open', 'closed')
       or v_plan_fact.planned_bar_count <= 0 then
      raise exception 'Для позиции «%» нет утверждённой карты раскроя с запланированными хлыстами',
        v_plan_fact.item_name;
    end if;

    if v_plan_fact.fact_bar_count > 0 then
      if v_plan_fact.plan_status <> 'closed'
         or v_plan_fact.fact_bar_count <> v_plan_fact.planned_bar_count then
        raise exception 'Не все хлысты позиции «%» закрыты начатыми производственными фактами',
          v_plan_fact.item_name;
      end if;
      if v_plan_fact.actual_loss_bar_count <> v_plan_fact.fact_bar_count then
        raise exception 'Для позиции «%» не записаны потери всех порезанных хлыстов',
          v_plan_fact.item_name;
      end if;
      if abs(v_plan_fact.reconciliation_delta_kg) > 0.001 then
        raise exception
          'Сверка веса не сошлась для позиции «%»: входной вес % кг, чистый % кг, пропил % кг, торцовка % кг, деловые остатки % кг, расхождение % кг',
          v_plan_fact.item_name,
          v_plan_fact.purchased_weight_kg,
          v_plan_fact.net_weight_kg,
          v_plan_fact.kerf_loss_weight_kg,
          v_plan_fact.end_trim_loss_weight_kg,
          v_plan_fact.business_scrap_weight_kg,
          v_plan_fact.reconciliation_delta_kg;
      end if;
    end if;
  end loop;

  insert into public.technologist_request_completions(
    request_id, machine_id, factory_id, created_by,
    future_detailing_decision, entered_plasma_minutes,
    added_plasma_minutes, actual_plasma_minutes
  ) values (
    p_request_id, v_request.machine_id, v_machine.factory_id, p_actor,
    p_decision, p_entered_plasma_minutes,
    ceil(p_entered_plasma_minutes * 0.25),
    p_entered_plasma_minutes + ceil(p_entered_plasma_minutes * 0.25)
  ) returning id into v_completion;

  insert into public.technologist_request_plan_fact_items(
    completion_id, request_id, source_table, source_id, plan_id, version_id,
    purchased_weight_kg, net_weight_kg,
    kerf_loss_weight_kg, end_trim_loss_weight_kg,
    business_scrap_weight_kg, reconciliation_delta_kg, fact_bar_count
  )
  select
    v_completion, p_request_id,
    fact.request_item_table, fact.request_item_id,
    fact.plan_id, fact.version_id,
    fact.purchased_weight_kg, fact.net_weight_kg,
    fact.kerf_loss_weight_kg, fact.end_trim_loss_weight_kg,
    fact.business_scrap_weight_kg, fact.reconciliation_delta_kg,
    fact.fact_bar_count
  from public.fn_get_long_stock_completion_plan_facts_v1(p_request_id) fact
  where fact.fact_bar_count > 0
    and fact.plan_status = 'closed'
    and fact.fact_bar_count = fact.planned_bar_count
    and fact.actual_loss_bar_count = fact.fact_bar_count
    and abs(fact.reconciliation_delta_kg) <= 0.001;

  -- Preserve the old percentage calculation only for ordinary positions.
  for v_item in
    select * from jsonb_array_elements(coalesce(p_waste_items, '[]'::jsonb))
  loop
    if v_item->>'sourceTable' not in (
      'request_sheet_metal', 'request_pipe', 'request_circle', 'request_knives'
    ) then
      raise exception 'Некорректный тип позиции';
    end if;
    if exists (
      select 1
      from public.long_stock_cutting_plan_items plan_item
      where plan_item.request_id = p_request_id
        and plan_item.request_item_table = v_item->>'sourceTable'
        and plan_item.request_item_id = (v_item->>'sourceId')::uuid
    ) then
      raise exception 'Позиция «%» учитывается по фактам карты раскроя; процент отхода передавать нельзя',
        coalesce(v_item->>'itemName', v_item->>'sourceId');
    end if;

    execute format(
      'select calculated_weight_kg from public.%I where id=$1 and request_id=$2',
      v_item->>'sourceTable'
    ) into v_weight using (v_item->>'sourceId')::uuid, p_request_id;
    if v_weight is null or v_weight <= 0 then
      raise exception 'Не рассчитан вес позиции: %', coalesce(v_item->>'itemName', v_item->>'sourceId');
    end if;

    v_pct := nullif(v_item->>'wastePercent', '')::numeric;
    if v_pct is null or v_pct < 0 or v_pct > 100 or v_pct <> round(v_pct, 1) then
      raise exception 'Отходность должна быть 0–100%% с точностью 0,1';
    end if;

    insert into public.technologist_request_waste_items(
      completion_id, request_id, source_table, source_id, item_name,
      material_id, material_variant_id, material_name, material_grade,
      weight_snapshot_kg, waste_percent, scrap_weight_kg, useful_weight_kg
    ) values (
      v_completion, p_request_id,
      v_item->>'sourceTable', (v_item->>'sourceId')::uuid,
      coalesce(nullif(v_item->>'itemName', ''), 'Позиция'),
      nullif(v_item->>'materialId', '')::uuid,
      nullif(v_item->>'materialVariantId', '')::uuid,
      coalesce(nullif(v_item->>'materialName', ''), 'Металл'),
      nullif(v_item->>'materialGrade', ''),
      v_weight, v_pct,
      round(v_weight * v_pct / 100, 3),
      round(v_weight - (v_weight * v_pct / 100), 3)
    ) returning id into v_part;

    insert into public.metal_scrap_lots(
      request_id, waste_item_id, machine_id, factory_id, created_by,
      material_id, material_variant_id, material_name, material_grade,
      expected_weight_kg
    )
    select
      p_request_id, v_part, v_request.machine_id, v_machine.factory_id, p_actor,
      material_id, material_variant_id, material_name, material_grade,
      scrap_weight_kg
    from public.technologist_request_waste_items
    where id = v_part
    returning id into v_lot;

    insert into public.metal_scrap_movements(
      lot_id, movement_type, weight_delta_kg,
      available_after_kg, blocked_after_kg, sold_after_kg, performed_by
    ) values (
      v_lot, 'planned', round(v_weight * v_pct / 100, 3),
      0, 0, 0, p_actor
    );
  end loop;

  insert into public.future_detailing_batches(
    request_id, machine_id, factory_id, created_by, status
  ) values (
    p_request_id, v_request.machine_id, v_machine.factory_id, p_actor,
    case when p_decision = 'none' then 'cancelled' else 'planned' end
  ) returning id into v_batch;

  for v_item in
    select * from jsonb_array_elements(coalesce(p_future_items, '[]'::jsonb))
  loop
    v_part := nullif(v_item->>'partId', '')::uuid;
    if v_part is null then
      insert into public.detailing_parts(
        name, drawing_number, unit_weight_kg, created_by, updated_by
      ) values (
        v_item->>'name', v_item->>'drawingNumber',
        (v_item->>'unitWeightKg')::numeric, p_actor, p_actor
      ) returning id into v_part;

      insert into public.detailing_part_products(
        part_id, product_id, applies_to_all_versions
      )
      select
        v_part, (compatibility->>'productId')::uuid,
        (compatibility->>'allVersions')::boolean
      from jsonb_array_elements(v_item->'compatibilities') compatibility;

      insert into public.detailing_part_product_versions(
        part_product_id, product_version_id
      )
      select product.id, version_id::uuid
      from jsonb_array_elements(v_item->'compatibilities') compatibility
      join public.detailing_part_products product
        on product.part_id = v_part
       and product.product_id = (compatibility->>'productId')::uuid
      cross join lateral jsonb_array_elements_text(
        coalesce(compatibility->'versionIds', '[]'::jsonb)
      ) version_id
      where not product.applies_to_all_versions;
    end if;

    if not exists (
      select 1 from public.detailing_parts where id = v_part and is_active
    ) then
      raise exception 'Карточка деталировки недоступна';
    end if;
    insert into public.future_detailing_items(batch_id, part_id, planned_quantity)
    values (v_batch, v_part, (v_item->>'quantity')::integer);
  end loop;

  update public.technologist_requests
  set status = 'submitted_to_supply', submitted_at = v_now, updated_at = v_now
  where id = p_request_id;
  update public.machines
  set status = 'request_ready', updated_at = v_now
  where id = v_request.machine_id and status = 'planned';

  return v_completion;
end;
$$;

revoke all on function public.fn_finalize_technologist_request(uuid, uuid, text, integer, jsonb, jsonb)
  from public, anon;
grant execute on function public.fn_finalize_technologist_request(uuid, uuid, text, integer, jsonb, jsonb)
  to authenticated;

create or replace function public.fn_finalize_technologist_request_with_archives(
  p_request_id uuid,
  p_actor uuid,
  p_decision text,
  p_entered_plasma_minutes integer,
  p_waste_items jsonb,
  p_future_items jsonb,
  p_archives jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public, storage, pg_temp as $$
declare
  v_request public.technologist_requests%rowtype;
  v_completion_id uuid;
  v_archive jsonb;
  v_storage storage.objects%rowtype;
  v_path_prefix text;
  v_file_size bigint;
  v_file_name text;
  v_object_path text;
  v_mime_type text;
begin
  if p_actor is null or p_actor <> auth.uid() then raise exception 'Недостаточно прав'; end if;
  if jsonb_typeof(coalesce(p_archives, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_archives, '[]'::jsonb)) > 20 then
    raise exception 'Можно прикрепить не более 20 архивов';
  end if;

  select * into v_request from public.technologist_requests where id = p_request_id for update;
  if not found or v_request.created_by <> p_actor then raise exception 'Заявка недоступна'; end if;
  if jsonb_array_length(coalesce(p_archives, '[]'::jsonb)) > 0 and not exists (
    select 1
    from public.request_sheet_metal sheet
    where sheet.request_id = p_request_id
  ) then
    raise exception 'Программа порезки доступна только для заявок с листовым металлом';
  end if;
  v_path_prefix := 'machine-cutting/' || v_request.machine_id || '/' || p_request_id || '/';

  for v_archive in select * from jsonb_array_elements(coalesce(p_archives, '[]'::jsonb)) loop
    v_file_name := btrim(coalesce(v_archive->>'fileName', ''));
    v_object_path := coalesce(v_archive->>'objectPath', '');
    v_mime_type := nullif(v_archive->>'mimeType', '');
    v_file_size := coalesce((v_archive->>'fileSize')::bigint, 0);
    if v_archive->>'requestId' is distinct from p_request_id::text
       or nullif(v_archive->>'completionId', '') is not null
       or v_file_name = '' or char_length(v_file_name) > 240
       or v_file_size <= 0 or v_file_size > 524288000
       or lower(v_file_name) !~ '\.(zip|rar|7z)$'
       or v_object_path not like v_path_prefix || '%'
       or v_object_path like '%..%'
       or lower(v_object_path) !~ '/[0-9]+-[0-9a-f-]{36}\.(zip|rar|7z)$' then
      raise exception 'Некорректный архив порезки';
    end if;
    select * into v_storage from storage.objects
      where bucket_id = 'nesting-files' and name = v_object_path;
    if not found then raise exception 'Загруженный архив не найден в хранилище'; end if;
    if coalesce((v_storage.metadata->>'size')::bigint, -1) <> v_file_size then
      raise exception 'Размер загруженного архива не совпадает с заявленным';
    end if;
  end loop;

  v_completion_id := public.fn_finalize_technologist_request(
    p_request_id, p_actor, p_decision, p_entered_plasma_minutes, p_waste_items, p_future_items
  );

  for v_archive in select * from jsonb_array_elements(coalesce(p_archives, '[]'::jsonb)) loop
    v_object_path := v_archive->>'objectPath';
    select * into v_storage from storage.objects
      where bucket_id = 'nesting-files' and name = v_object_path;
    insert into public.machine_cutting_archives (
      machine_id, request_id, completion_id, file_name, storage_path,
      mime_type, file_size, uploaded_by
    ) values (
      v_request.machine_id, p_request_id, v_completion_id, btrim(v_archive->>'fileName'), v_object_path,
      coalesce(nullif(v_storage.metadata->>'mimetype', ''), nullif(v_archive->>'mimeType', '')),
      (v_storage.metadata->>'size')::bigint, p_actor
    );
  end loop;
  return v_completion_id;
end;
$$;
revoke all on function public.fn_finalize_technologist_request_with_archives(uuid,uuid,text,integer,jsonb,jsonb,jsonb)
  from public, anon;
grant execute on function public.fn_finalize_technologist_request_with_archives(uuid,uuid,text,integer,jsonb,jsonb,jsonb)
  to authenticated;

comment on table public.technologist_request_plan_fact_items is
  'Optional immutable completion snapshot when a fully reconciled production fact already existed before handoff. Normal planning-stage completions are intentionally not blocked by future cutting facts.';

notify pgrst, 'reload schema';
