-- One immutable PDF artifact per approved long-stock cutting-plan version.
-- The bytes live in the existing private product-files bucket; metadata is sealed on the version.

alter function public.fn_approve_long_stock_cutting_plan_version_v1(uuid, uuid)
  rename to fn_approve_long_stock_cutting_plan_version_core_v1;

revoke all on function public.fn_approve_long_stock_cutting_plan_version_core_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

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
    if new.pdf_metadata <> '{}'::jsonb then
      raise exception 'PDF добавляется только при утверждении версии карты раскроя';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Версия карты раскроя неизменяема';
  end if;

  if current_setting('app.long_stock_cutting_pdf_metadata', true) = '1' then
    if new.id is distinct from old.id
      or new.plan_id is distinct from old.plan_id
      or new.version_number is distinct from old.version_number
      or new.input_snapshot is distinct from old.input_snapshot
      or new.input_fingerprint is distinct from old.input_fingerprint
      or new.settings_snapshot is distinct from old.settings_snapshot
      or new.selected_candidate_number is distinct from old.selected_candidate_number
      or new.status is distinct from old.status
      or new.invalidation_reason is distinct from old.invalidation_reason
      or new.invalidation_receipt_schedule_id is distinct from old.invalidation_receipt_schedule_id
      or new.manual_edit_reason is distinct from old.manual_edit_reason
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at
      or new.invalidated_by is distinct from old.invalidated_by
      or new.invalidated_at is distinct from old.invalidated_at
      or new.definition_sealed is distinct from old.definition_sealed
      or old.pdf_metadata <> '{}'::jsonb
      or jsonb_typeof(new.pdf_metadata) <> 'object'
      or new.pdf_metadata = '{}'::jsonb then
      raise exception 'Метаданные PDF версии карты раскроя неизменяемы';
    end if;
    return new;
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
  v_version public.long_stock_cutting_plan_versions%rowtype;
  v_plan public.long_stock_cutting_plans%rowtype;
  v_result jsonb;
  v_effective_pdf_metadata jsonb;
  v_expected_path_prefix text;
  v_expected_file_name text;
begin
  select * into v_version
  from public.long_stock_cutting_plan_versions
  where id = p_version_id
  for update;
  if not found then raise exception 'Версия карты раскроя не найдена'; end if;

  select * into v_plan
  from public.long_stock_cutting_plans
  where id = v_version.plan_id;
  if not found then raise exception 'Карта раскроя не найдена'; end if;
  if v_version.status = 'invalid' then
    raise exception 'Недействительная версия требует пересчёта; PDF недоступен';
  end if;
  if v_version.status not in ('draft', 'approved') then
    raise exception 'PDF формируется только для утверждаемой версии карты раскроя';
  end if;

  if v_version.pdf_metadata <> '{}'::jsonb
    and v_version.pdf_metadata is distinct from p_pdf_metadata then
    raise exception 'PDF этой версии уже сформирован и не может быть заменён';
  end if;
  v_effective_pdf_metadata := case
    when v_version.pdf_metadata <> '{}'::jsonb then v_version.pdf_metadata
    else p_pdf_metadata
  end;

  if jsonb_typeof(v_effective_pdf_metadata) <> 'object'
    or (v_effective_pdf_metadata->>'schema_version')::integer is distinct from 1
    or v_effective_pdf_metadata->>'bucket_id' is distinct from 'product-files'
    or v_effective_pdf_metadata->>'mime_type' is distinct from 'application/pdf'
    or (v_effective_pdf_metadata->>'size_bytes')::bigint is null
    or (v_effective_pdf_metadata->>'size_bytes')::bigint <= 0
    or coalesce(v_effective_pdf_metadata->>'sha256', '') !~ '^[0-9a-f]{64}$'
    or (v_effective_pdf_metadata->>'generated_by')::uuid is distinct from p_actor
    or (v_effective_pdf_metadata->>'generated_at')::timestamptz is null then
    raise exception 'Некорректные метаданные PDF карты раскроя';
  end if;

  v_expected_path_prefix := format(
    'long-stock-cutting-plans/%s/%s/',
    v_plan.id,
    v_version.id
  );
  v_expected_file_name := format(
    'cutting-plan-%s-v%s.pdf',
    v_plan.plan_number,
    v_version.version_number
  );
  if coalesce(v_effective_pdf_metadata->>'object_path', '') not like (v_expected_path_prefix || '%')
    or substring(coalesce(v_effective_pdf_metadata->>'object_path', '') from char_length(v_expected_path_prefix) + 1)
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$'
    or v_effective_pdf_metadata->>'file_name' is distinct from v_expected_file_name then
    raise exception 'Путь или имя PDF не соответствует версии карты раскроя';
  end if;

  if v_version.pdf_metadata <> '{}'::jsonb then
    v_result := public.fn_approve_long_stock_cutting_plan_version_core_v1(p_version_id, p_actor);
    return v_result || jsonb_build_object('pdf_metadata', v_version.pdf_metadata);
  end if;

  perform set_config('app.long_stock_cutting_pdf_metadata', '1', true);
  update public.long_stock_cutting_plan_versions
  set pdf_metadata = v_effective_pdf_metadata
  where id = p_version_id;
  perform set_config('app.long_stock_cutting_pdf_metadata', '', true);

  v_result := public.fn_approve_long_stock_cutting_plan_version_core_v1(p_version_id, p_actor);
  return v_result || jsonb_build_object('pdf_metadata', v_effective_pdf_metadata);
end;
$$;

comment on function public.fn_approve_long_stock_cutting_plan_version_v2(uuid, uuid, jsonb) is
  'Atomically seals immutable PDF metadata and approves the matching immutable plan-version snapshot.';
comment on column public.long_stock_cutting_plan_versions.pdf_metadata is
  'Immutable PDF artifact metadata: private bucket/path, file name, byte size, SHA-256, generator and generation time.';

revoke all on function public.fn_long_stock_cutting_version_guard()
  from public, anon, authenticated, service_role;
revoke all on function public.fn_approve_long_stock_cutting_plan_version_v2(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.fn_approve_long_stock_cutting_plan_version_v2(uuid, uuid, jsonb)
  to service_role;
