-- Optional ProNest report accounting for sheet positions. Legacy waste rows keep
-- their original interpretation and constraint.
create table public.technologist_pronest_reports (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.technologist_requests(id) on delete restrict,
  source_item_id uuid not null references public.request_sheet_metal(id) on delete restrict,
  approval_version_id uuid references public.technologist_request_approval_versions(id) on delete restrict,
  import_version integer not null check (import_version > 0),
  storage_path text not null check (storage_path like 'pronest/%' and storage_path not like '%..%'),
  file_name text not null,
  file_size integer not null check (file_size between 1 and 52428800),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  parser_version integer not null,
  page_count integer not null check (page_count between 1 and 100),
  original_layouts jsonb not null,
  ocr_raw_pages jsonb not null default '{}'::jsonb,
  confirmed_sheets jsonb not null,
  material_confirmed boolean not null,
  weight_difference_reason text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(request_id, source_item_id, import_version)
);
create index technologist_pronest_reports_request_idx on public.technologist_pronest_reports(request_id, source_item_id);
alter table public.technologist_pronest_reports enable row level security;
revoke all on public.technologist_pronest_reports from public, anon, authenticated;
grant select, insert, update on public.technologist_pronest_reports to service_role;

create table public.technologist_pronest_report_edits (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.technologist_pronest_reports(id) on delete restrict,
  page integer not null,
  instance_number integer not null,
  field_name text not null,
  original_value jsonb,
  confirmed_value jsonb,
  reason text,
  edited_by uuid not null references auth.users(id),
  edited_at timestamptz not null default now()
);
create index technologist_pronest_edits_report_idx on public.technologist_pronest_report_edits(report_id,page,instance_number);
alter table public.technologist_pronest_report_edits enable row level security;
revoke all on public.technologist_pronest_report_edits from public,anon,authenticated;
grant select,insert on public.technologist_pronest_report_edits to service_role;

create function public.fn_record_pronest_edits_v1() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_sheet jsonb; v_original jsonb; v_field text; v_before jsonb; v_after jsonb;
  v_index integer := 0; v_useful_adjustment numeric := 0;
begin
  select coalesce(round(sum((value->>'sheetWeightKg')::numeric * (value->>'actualUtilizationPercent')::numeric
      / 100 * (value->>'timesCut')::integer),3)
      - sum(round((value->>'sheetWeightKg')::numeric * (value->>'actualUtilizationPercent')::numeric
      / 100,3) * (value->>'timesCut')::integer),0)
  into v_useful_adjustment from jsonb_array_elements(new.original_layouts);
  for v_sheet in select value from jsonb_array_elements(new.confirmed_sheets) loop
    v_index := v_index + 1;
    select value into v_original from jsonb_array_elements(new.original_layouts)
    where (value->>'page')::integer=(v_sheet->>'page')::integer
      and (value->>'layoutNumber')::integer=(v_sheet->>'layoutNumber')::integer limit 1;
    if v_original is null then raise exception 'Экземпляр листа без исходного раскроя PDF'; end if;
    for v_field in select unnest(array[
      'material','thicknessMm','equipment','process','sheetWidthMm','sheetLengthMm','cropWidthMm','cropLengthMm',
      'sheetWeightKg','actualUtilizationPercent','cropUtilizationPercent','pierces',
      'sheetName','heatNumber','inventoryNumber','location'
    ]) loop
      v_before := v_original->v_field;
      v_after := v_sheet->'source'->v_field;
      if v_before is distinct from v_after then
        if btrim(coalesce(v_sheet->>'reason',''))='' then raise exception 'Для исправления PDF нужна причина'; end if;
        insert into public.technologist_pronest_report_edits(
          report_id,page,instance_number,field_name,original_value,confirmed_value,reason,edited_by)
        values(new.id,(v_sheet->>'page')::integer,(v_sheet->>'instanceNumber')::integer,
          v_field,v_before,v_after,v_sheet->>'reason',new.created_by);
      end if;
    end loop;
    for v_field in select unnest(array['usefulWeightKg','kerfWidthMm','cutLengthMm','productionSeconds']) loop
      v_before := case v_field
        when 'usefulWeightKg' then to_jsonb(round((v_original->>'sheetWeightKg')::numeric*(v_original->>'actualUtilizationPercent')::numeric/100,3)
          + case when v_index=jsonb_array_length(new.confirmed_sheets) then v_useful_adjustment else 0 end)
        else v_original->v_field end;
      v_after := v_sheet->v_field;
      if v_before is distinct from v_after then
        if btrim(coalesce(v_sheet->>'reason',''))='' then raise exception 'Для исправления PDF нужна причина'; end if;
        insert into public.technologist_pronest_report_edits(
          report_id,page,instance_number,field_name,original_value,confirmed_value,reason,edited_by)
        values(new.id,(v_sheet->>'page')::integer,(v_sheet->>'instanceNumber')::integer,
          v_field,v_before,v_after,v_sheet->>'reason',new.created_by);
      end if;
    end loop;
    if v_sheet->>'decision' is distinct from 'none' then
      insert into public.technologist_pronest_report_edits(
        report_id,page,instance_number,field_name,original_value,confirmed_value,reason,edited_by)
      values(new.id,(v_sheet->>'page')::integer,(v_sheet->>'instanceNumber')::integer,
        'remnantDecision',to_jsonb('none'::text),jsonb_build_object(
          'decision',v_sheet->>'decision','remnants',coalesce(v_sheet->'remnants','[]'::jsonb)),
        nullif(v_sheet->>'reason',''),new.created_by);
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.fn_record_pronest_edits_v1() from public,anon,authenticated;
create trigger record_pronest_edits after insert on public.technologist_pronest_reports
for each row execute function public.fn_record_pronest_edits_v1();

create function public.fn_guard_pronest_report_v1() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.approval_version_id is not null then
    raise exception 'Утверждённую или отправленную версию PDF нельзя изменить';
  end if;
  if new.approval_version_id is not null and
     not exists (select 1 from public.technologist_request_approval_versions v
       where v.id = new.approval_version_id and v.request_id = old.request_id
       and v.completion_payload->'wasteItems' @> jsonb_build_array(jsonb_build_object(
         'sourceId',old.source_item_id,'reportId',old.id,'mode','pdf'))) then
    raise exception 'Отчёт не относится к версии согласования';
  end if;
  if (to_jsonb(new) - 'approval_version_id') is distinct from (to_jsonb(old) - 'approval_version_id') then
    raise exception 'Исходный PDF и подтверждённые данные неизменяемы';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_guard_pronest_report_v1() from public, anon, authenticated;
create trigger guard_pronest_report before update on public.technologist_pronest_reports
for each row execute function public.fn_guard_pronest_report_v1();

create function public.fn_link_pronest_approval_v1() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item jsonb; v_count integer;
begin
  for v_item in select value from jsonb_array_elements(coalesce(new.completion_payload->'wasteItems','[]'::jsonb)) loop
    if v_item->>'mode' is distinct from 'pdf' then continue; end if;
    update public.technologist_pronest_reports report
      set approval_version_id = new.id
      where report.id = (v_item->>'reportId')::uuid
        and report.request_id = new.request_id
        and report.source_item_id = (v_item->>'sourceId')::uuid
        and report.approval_version_id is null;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception 'PDF отчёт не подготовлен для этой позиции'; end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.fn_link_pronest_approval_v1() from public, anon, authenticated;
create trigger link_pronest_approval after insert on public.technologist_request_approval_versions
for each row execute function public.fn_link_pronest_approval_v1();

alter table public.technologist_request_waste_items
  add column input_mode text not null default 'manual' check (input_mode in ('manual','pdf')),
  add column pdf_sheet_weight_kg numeric(14,3),
  add column kerf_weight_kg numeric(14,3) not null default 0,
  add column total_loss_percent numeric(8,4),
  add column pronest_report_id uuid references public.technologist_pronest_reports(id) on delete restrict;
alter table public.technologist_request_waste_items drop constraint technologist_waste_weight_balance;
alter table public.technologist_request_waste_items
  add constraint technologist_waste_weight_balance check (
    abs(weight_snapshot_kg - business_scrap_weight_kg - scrap_weight_kg - useful_weight_kg - kerf_weight_kg)
      <= case when input_mode='manual' then 0.001 else 0.002 end
    and waste_basis_kg >= 0 and business_scrap_weight_kg >= 0 and kerf_weight_kg >= 0
    and (input_mode = 'manual' and kerf_weight_kg = 0 and pronest_report_id is null
      or input_mode = 'pdf' and pdf_sheet_weight_kg is not null and pronest_report_id is not null and total_loss_percent is not null)
  );

alter table public.technologist_sheet_scrap_plans
  alter column length_mm type numeric(12,2),
  alter column width_mm type numeric(12,2),
  add column pronest_report_id uuid references public.technologist_pronest_reports(id) on delete restrict,
  add column pronest_page integer,
  add column pronest_layout_number integer,
  add column pronest_instance_number integer,
  add column pdf_weight_kg numeric(14,3),
  add column warehouse_weight_kg numeric(14,3);

alter table public.technologist_request_completions
  add column entered_plasma_seconds integer,
  add column actual_plasma_seconds integer;

create function public.fn_calculate_pronest_position_v1(p_report_id uuid, p_request_id uuid, p_source_item_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_report public.technologist_pronest_reports%rowtype;
  v_sheet public.request_sheet_metal%rowtype;
  v_page jsonb;
  v_source jsonb;
  v_remnant jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_area numeric;
  v_used_area numeric;
  v_width numeric;
  v_length numeric;
  v_weight numeric;
  v_remnant_weight numeric;
  v_useful numeric;
  v_kerf numeric;
  v_metal numeric;
  v_basis numeric;
  v_total_weight numeric := 0;
  v_total_remnant numeric := 0;
  v_total_useful numeric := 0;
  v_total_kerf numeric := 0;
  v_total_metal numeric := 0;
  v_total_basis numeric := 0;
  v_total_seconds integer := 0;
  v_seen text[] := '{}';
  v_key text;
  v_review_field text;
  v_index integer := 0;
  v_useful_adjustment numeric := 0;
  v_default_useful numeric;
begin
  select * into strict v_report from public.technologist_pronest_reports
    where id=p_report_id and request_id=p_request_id and source_item_id=p_source_item_id
      and approval_version_id is not null and material_confirmed;
  select * into strict v_sheet from public.request_sheet_metal
    where id=p_source_item_id and request_id=p_request_id;
  if jsonb_typeof(v_report.confirmed_sheets) <> 'array' or
     jsonb_array_length(v_report.confirmed_sheets) <> v_sheet.quantity_sheets then
    raise exception 'Количество листов PDF не совпадает с позицией';
  end if;
  select coalesce(round(sum((value->>'sheetWeightKg')::numeric * (value->>'actualUtilizationPercent')::numeric
      / 100 * (value->>'timesCut')::integer),3)
      - sum(round((value->>'sheetWeightKg')::numeric * (value->>'actualUtilizationPercent')::numeric
      / 100,3) * (value->>'timesCut')::integer),0)
  into v_useful_adjustment from jsonb_array_elements(v_report.original_layouts);
  for v_page in select value from jsonb_array_elements(v_report.confirmed_sheets) loop
    v_index := v_index + 1;
    v_source := v_page->'source';
    v_key := v_page->>'layoutNumber' || ':' || v_page->>'instanceNumber';
    if v_key = any(v_seen) then raise exception 'Повторный экземпляр листа PDF'; end if;
    v_seen := array_append(v_seen,v_key);
    v_width := (v_source->>'sheetWidthMm')::numeric;
    v_length := (v_source->>'sheetLengthMm')::numeric;
    v_area := v_width*v_length;
    v_weight := (v_source->>'sheetWeightKg')::numeric;
    if v_area <= 0 or v_weight <= 0 or
       not public.fn_same_rectangular_dimensions_v1(v_sheet.sheet_size,v_width || 'x' || v_length) or
       abs((v_source->>'thicknessMm')::numeric - v_sheet.thickness_mm) > 0.01 then
      raise exception 'Лист PDF не совпадает с позицией заявки';
    end if;
    v_used_area := 0;
    v_remnant_weight := 0;
    if v_page->>'decision' = 'preserve' then
      for v_remnant in select value from jsonb_array_elements(coalesce(v_page->'remnants','[]'::jsonb)) loop
        if (v_remnant->>'lengthMm')::numeric <= 0 or (v_remnant->>'widthMm')::numeric <= 0 or
           (v_remnant->>'lengthMm')::numeric <> round((v_remnant->>'lengthMm')::numeric,2) or
           (v_remnant->>'widthMm')::numeric <> round((v_remnant->>'widthMm')::numeric,2) or
           not (((v_remnant->>'lengthMm')::numeric <= v_length and (v_remnant->>'widthMm')::numeric <= v_width)
             or ((v_remnant->>'lengthMm')::numeric <= v_width and (v_remnant->>'widthMm')::numeric <= v_length)) then
          raise exception 'Деловой остаток не помещается в лист';
        end if;
        v_used_area := v_used_area + (v_remnant->>'lengthMm')::numeric*(v_remnant->>'widthMm')::numeric;
        v_remnant_weight := v_remnant_weight + coalesce((v_remnant->>'weightKg')::numeric,
          round(v_weight*(v_remnant->>'lengthMm')::numeric*(v_remnant->>'widthMm')::numeric/v_area,3));
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'lengthMm',(v_remnant->>'lengthMm')::numeric,'widthMm',(v_remnant->>'widthMm')::numeric,
          'quantity',1,'weightKg',coalesce((v_remnant->>'weightKg')::numeric,
            round(v_weight*(v_remnant->>'lengthMm')::numeric*(v_remnant->>'widthMm')::numeric/v_area,3)),
          'page',(v_page->>'page')::integer,'layoutNumber',(v_page->>'layoutNumber')::integer,
          'instanceNumber',(v_page->>'instanceNumber')::integer));
      end loop;
    elsif v_page->>'decision' not in ('scrap','none') then
      raise exception 'Некорректное решение по деловому остатку';
    end if;
    if v_used_area >= v_area then raise exception 'Площадь деловых остатков превышает лист'; end if;
    v_remnant_weight := round(v_remnant_weight,3);
    v_useful := round((v_page->>'usefulWeightKg')::numeric,3);
    v_default_useful := round(v_weight*(v_source->>'actualUtilizationPercent')::numeric/100,3)
      + case when v_index=jsonb_array_length(v_report.confirmed_sheets) then v_useful_adjustment else 0 end;
    v_kerf := round(v_weight*(v_page->>'kerfWidthMm')::numeric*(v_page->>'cutLengthMm')::numeric/v_area,3);
    v_metal := round(v_weight-v_useful-v_remnant_weight-v_kerf,3);
    v_basis := round(v_weight-v_remnant_weight,3);
    if v_useful < 0 or v_kerf < 0 or v_metal < 0 or v_basis <= 0 or
       (v_page->>'productionSeconds')::integer < 0 then
      raise exception 'Весовой баланс или время PDF некорректны';
    end if;
    if (abs(v_useful - v_default_useful) > 0.001
       or (v_page->>'kerfWidthMm')::numeric <> (v_source->>'kerfWidthMm')::numeric
       or (v_page->>'cutLengthMm')::numeric <> (v_source->>'cutLengthMm')::numeric
       or (v_page->>'productionSeconds')::integer <> (v_source->>'productionSeconds')::integer)
       and btrim(coalesce(v_page->>'reason','')) = '' then
      raise exception 'Для исправления или сохранения остатка укажите причину';
    end if;
    if not coalesce((v_page->>'reviewed')::boolean,false) then raise exception 'Проверьте каждый лист PDF'; end if;
    for v_review_field in select key from jsonb_each(coalesce(v_source->'evidence','{}'::jsonb))
      where coalesce((value->>'reviewRequired')::boolean,false) loop
      if not (coalesce(v_page->'reviewedFields','[]'::jsonb) ? v_review_field) then
        raise exception 'Проверьте сомнительное поле PDF: %',v_review_field;
      end if;
    end loop;
    v_count := v_count+1;
    v_total_weight := v_total_weight+v_weight;
    v_total_remnant := v_total_remnant+v_remnant_weight;
    v_total_useful := v_total_useful+v_useful;
    v_total_kerf := v_total_kerf+v_kerf;
    v_total_metal := v_total_metal+v_metal;
    v_total_basis := v_total_basis+v_basis;
    v_total_seconds := v_total_seconds+(v_page->>'productionSeconds')::integer;
  end loop;
  return jsonb_build_object('rows',v_rows,'sourceWeightKg',v_total_weight,
    'scrapWeightKg',v_total_remnant,'wasteBasisKg',v_total_basis,
    'metalScrapKg',v_total_metal,'usefulKg',v_total_useful,'kerfKg',v_total_kerf,
    'totalLossPercent',round((v_total_metal+v_total_kerf)*100/v_total_basis,4),
    'enteredSeconds',v_total_seconds);
end;
$$;
revoke all on function public.fn_calculate_pronest_position_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.fn_calculate_pronest_position_v1(uuid,uuid,uuid) to service_role;

-- Extend only the sheet branch of the current finalizer. The release fails if
-- the installed finalizer has changed, rather than silently applying a patch.
do $migration$
declare v_definition text; v_old text; v_new text;
begin
  v_definition := pg_get_functiondef('public.fn_finalize_technologist_request(uuid,uuid,text,integer,jsonb,jsonb)'::regprocedure);
  v_old := $old$
      v_sheet_result := public.fn_calculate_sheet_scrap_plan_v1(
        v_sheet.sheet_size,v_sheet.quantity_sheets,v_weight,
        coalesce(v_item->'futureScraps','[]'::jsonb),v_pct
      );$old$;
  v_new := $new$
      if v_item->>'mode' = 'pdf' then
        if nullif(v_item->>'reportId','') is null then raise exception 'Укажите отчёт PDF'; end if;
        v_sheet_result := public.fn_calculate_pronest_position_v1(
          (v_item->>'reportId')::uuid,p_request_id,v_sheet.id);
        v_weight := (v_sheet_result->>'sourceWeightKg')::numeric;
        v_pct := round((v_sheet_result->>'totalLossPercent')::numeric,1);
      else
        v_sheet_result := public.fn_calculate_sheet_scrap_plan_v1(
          v_sheet.sheet_size,v_sheet.quantity_sheets,v_weight,
          coalesce(v_item->'futureScraps','[]'::jsonb),v_pct);
      end if;$new$;
  if position(v_old in v_definition)=0 then raise exception 'Unexpected sheet completion calculation'; end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$      weight_snapshot_kg, waste_basis_kg, business_scrap_weight_kg,
      waste_percent, scrap_weight_kg, useful_weight_kg$old$;
  v_new := $new$      weight_snapshot_kg, waste_basis_kg, business_scrap_weight_kg,
      waste_percent, scrap_weight_kg, useful_weight_kg,
      input_mode, pdf_sheet_weight_kg, kerf_weight_kg, total_loss_percent, pronest_report_id$new$;
  if position(v_old in v_definition)=0 then raise exception 'Unexpected sheet waste columns'; end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$      v_pct, v_metal_scrap, v_useful
    ) returning id into v_part;$old$;
  v_new := $new$      v_pct, v_metal_scrap, v_useful,
      case when v_item->>'mode'='pdf' then 'pdf' else 'manual' end,
      case when v_item->>'mode'='pdf' then v_weight else null end,
      coalesce((v_sheet_result->>'kerfKg')::numeric,0),
      case when v_item->>'mode'='pdf' then (v_sheet_result->>'totalLossPercent')::numeric else null end,
      case when v_item->>'mode'='pdf' then (v_item->>'reportId')::uuid else null end
    ) returning id into v_part;$new$;
  if position(v_old in v_definition)=0 then raise exception 'Unexpected sheet waste values'; end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$          completion_id,request_id,source_item_id,line_number,inventory_id,length_mm,width_mm,quantity,weight_kg$old$;
  v_new := $new$          completion_id,request_id,source_item_id,line_number,inventory_id,length_mm,width_mm,quantity,weight_kg,
          pronest_report_id,pronest_page,pronest_layout_number,pronest_instance_number,pdf_weight_kg,warehouse_weight_kg$new$;
  if position(v_old in v_definition)=0 then raise exception 'Unexpected remnant columns'; end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$          (v_sheet_scrap->>'quantity')::integer,(v_sheet_scrap->>'weightKg')::numeric
        );$old$;
  v_new := $new$          (v_sheet_scrap->>'quantity')::integer,(v_sheet_scrap->>'weightKg')::numeric,
          case when v_item->>'mode'='pdf' then (v_item->>'reportId')::uuid else null end,
          nullif(v_sheet_scrap->>'page','')::integer,
          nullif(v_sheet_scrap->>'layoutNumber','')::integer,
          nullif(v_sheet_scrap->>'instanceNumber','')::integer,
          case when v_item->>'mode'='pdf' then (v_sheet_scrap->>'weightKg')::numeric else null end,
          case when v_item->>'mode'='pdf' then round(
            v_sheet.calculated_weight_kg/v_sheet.quantity_sheets
            * (v_sheet_scrap->>'lengthMm')::numeric * (v_sheet_scrap->>'widthMm')::numeric
            / ((public.parse_size_dimensions(v_sheet.sheet_size))[1]
              * (public.parse_size_dimensions(v_sheet.sheet_size))[2]),3) else null end
        );$new$;
  if position(v_old in v_definition)=0 then raise exception 'Unexpected remnant values'; end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$  v_scrap_ordinal integer;$old$;
  v_new := $new$  v_scrap_ordinal integer;
  v_pronest_seconds integer;
  v_pronest_manual_minutes integer;$new$;
  if position(v_old in v_definition)=0 then raise exception 'Unexpected completion declarations'; end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$  insert into public.future_detailing_batches($old$;
  v_new := $new$  if exists (select 1 from jsonb_array_elements(coalesce(p_waste_items,'[]'::jsonb)) item
    where item->>'mode'='pdf') then
    v_pronest_seconds := 0;
    for v_item in select value from jsonb_array_elements(p_waste_items)
      where value->>'mode'='pdf' loop
      v_sheet_result := public.fn_calculate_pronest_position_v1(
        (v_item->>'reportId')::uuid,p_request_id,(v_item->>'sourceId')::uuid);
      v_pronest_seconds := v_pronest_seconds+(v_sheet_result->>'enteredSeconds')::integer;
    end loop;
    select coalesce((item->>'manualPlasmaMinutes')::integer,0) into v_pronest_manual_minutes
    from jsonb_array_elements(p_waste_items) item where item->>'mode'='pdf' limit 1;
    if v_pronest_manual_minutes < 0 then raise exception 'Некорректное ручное время плазмы'; end if;
    v_pronest_seconds := v_pronest_seconds+v_pronest_manual_minutes*60;
    if p_entered_plasma_minutes <> ceil(v_pronest_seconds::numeric/60) then
      raise exception 'Время плазмы не совпадает с отчётами PDF';
    end if;
    update public.technologist_request_completions set
      entered_plasma_seconds=v_pronest_seconds,
      actual_plasma_seconds=ceil(v_pronest_seconds*1.25),
      entered_plasma_minutes=ceil(v_pronest_seconds::numeric/60),
      actual_plasma_minutes=ceil(ceil(v_pronest_seconds*1.25)::numeric/60),
      added_plasma_minutes=ceil(ceil(v_pronest_seconds*1.25)::numeric/60)-ceil(v_pronest_seconds::numeric/60)
    where id=v_completion;
  end if;

  insert into public.future_detailing_batches($new$;
  if position(v_old in v_definition)=0 then raise exception 'Unexpected completion time position'; end if;
  v_definition := replace(v_definition,v_old,v_new);
  execute v_definition;
end;
$migration$;

-- The legacy correction RPC derives scrap directly from waste_percent. Keep it
-- available for manual positions, while preserving PDF balances and seconds.
do $migration$
declare v_definition text; v_old text; v_new text;
begin
  v_definition := pg_get_functiondef('public.fn_correct_technologist_completion(uuid,integer,jsonb,text,uuid)'::regprocedure);
  v_old := $old$  v_old:=jsonb_build_object('enteredPlasmaMinutes',v_completion.entered_plasma_minutes,$old$;
  v_new := $new$  if exists (select 1 from public.technologist_request_waste_items
    where request_id=p_request_id and input_mode='pdf')
    and p_entered_plasma_minutes <> v_completion.entered_plasma_minutes then
    raise exception 'Время PDF исправляется через новую версию отчёта';
  end if;
  v_old:=jsonb_build_object('enteredPlasmaMinutes',v_completion.entered_plasma_minutes,$new$;
  if position(v_old in v_definition)=0 then raise exception 'Unexpected correction time calculation'; end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$    v_new_expected:=round(v_waste.waste_basis_kg*(v_item->>'wastePercent')::numeric/100,3);$old$;
  v_new := $new$    if v_waste.input_mode='pdf' then
      raise exception 'PDF-позиция исправляется через новую версию отчёта';
    end if;
    v_new_expected:=round(v_waste.waste_basis_kg*(v_item->>'wastePercent')::numeric/100,3);$new$;
  if position(v_old in v_definition)=0 then raise exception 'Unexpected correction waste calculation'; end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$  update public.technologist_request_completions
  set entered_plasma_minutes=p_entered_plasma_minutes,
    added_plasma_minutes=ceil(p_entered_plasma_minutes*0.25),
    actual_plasma_minutes=p_entered_plasma_minutes+ceil(p_entered_plasma_minutes*0.25),updated_at=now()
  where id=v_completion.id;$old$;
  v_new := $new$  if exists (select 1 from public.technologist_request_waste_items
    where request_id=p_request_id and input_mode='pdf') then
    update public.technologist_request_completions set updated_at=now()
    where id=v_completion.id;
  else
    update public.technologist_request_completions
    set entered_plasma_minutes=p_entered_plasma_minutes,
      added_plasma_minutes=ceil(p_entered_plasma_minutes*0.25),
      actual_plasma_minutes=p_entered_plasma_minutes+ceil(p_entered_plasma_minutes*0.25),updated_at=now()
    where id=v_completion.id;
  end if;$new$;
  if position(v_old in v_definition)=0 then raise exception 'Unexpected correction time update'; end if;
  v_definition := replace(v_definition,v_old,v_new);
  execute v_definition;
end;
$migration$;
