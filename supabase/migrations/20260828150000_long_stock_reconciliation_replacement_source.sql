-- Feed preserved physical reservations from legacy-source reconciliation into
-- the existing replacement-version workflow. This keeps the old item and
-- version immutable while version 2 is calculated from the exact bar lengths.

alter table public.long_stock_recalculation_replacements
  drop constraint if exists long_stock_recalculation_replacements_source_kind_check;
alter table public.long_stock_recalculation_replacements
  add constraint long_stock_recalculation_replacements_source_kind_check
  check (source_kind in (
    'supply_return', 'supply_receipt', 'inventory_transfer', 'inventory_reconciliation'
  ));

do $migration$
declare
  v_definition text;
  v_anchor text := E'  v_detected_source_kind := case\n    when v_invalid_version.invalidation_department_request_id is not null then \'supply_return\'\n    when v_invalid_version.invalidation_receipt_schedule_id is not null then \'supply_receipt\'\n    when v_invalid_version.invalidation_inventory_transfer_id is not null then \'inventory_transfer\'\n    else null\n  end;';
  v_replacement text := E'  v_detected_source_kind := case\n    when exists (\n      select 1\n      from public.long_stock_cutting_source_reconciliations reconciliation\n      where reconciliation.version_id = v_invalid_version.id\n        and reconciliation.status = \'invalidated\'\n    ) then \'inventory_reconciliation\'\n    when v_invalid_version.invalidation_department_request_id is not null then \'supply_return\'\n    when v_invalid_version.invalidation_receipt_schedule_id is not null then \'supply_receipt\'\n    when v_invalid_version.invalidation_inventory_transfer_id is not null then \'inventory_transfer\'\n    else null\n  end;';
begin
  v_definition := pg_get_functiondef(
    'public.fn_prepare_long_stock_recalculation_replacement_v1(text,uuid,uuid,text,numeric[],uuid)'::regprocedure
  );
  if position(v_anchor in v_definition) = 0 then
    raise exception 'Не найден источник пересчёта в функции подготовки замены';
  end if;
  execute replace(v_definition, v_anchor, v_replacement);
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_source_anchor text := E'  else\n    select array_agg(length_mm order by length_mm)\n    into v_current_allowed_lengths\n    from (\n      select distinct transfer_item.piece_length_mm as length_mm';
  v_source_replacement text := E'  elsif v_replacement.source_kind = \'inventory_reconciliation\' then\n    select array_agg(length_mm order by length_mm)\n    into v_current_allowed_lengths\n    from (\n      select distinct (source->>\'length_mm\')::numeric as length_mm\n      from public.long_stock_cutting_source_reconciliations reconciliation\n      cross join lateral jsonb_array_elements(reconciliation.actual_sources) source\n      where reconciliation.version_id = v_replacement.source_version_id\n        and reconciliation.status = \'invalidated\'\n        and coalesce((source->>\'length_mm\')::numeric, 0) > 0\n    ) lengths;\n  else\n    select array_agg(length_mm order by length_mm)\n    into v_current_allowed_lengths\n    from (\n      select distinct transfer_item.piece_length_mm as length_mm';
  v_message_anchor text := E'      when \'supply_receipt\' then \'Не найдены фактически принятые длины, включая распределённые поставки\'\n      else \'Не найдены фактически принятые длины межзаводского перемещения\'';
  v_message_replacement text := E'      when \'supply_receipt\' then \'Не найдены фактически принятые длины, включая распределённые поставки\'\n      when \'inventory_reconciliation\' then \'Не найдены сохранённые физические резервы сверки\'\n      else \'Не найдены фактически принятые длины межзаводского перемещения\'';
begin
  v_definition := pg_get_functiondef(
    'public.fn_approve_long_stock_recalculation_replacement_v1(uuid,uuid,jsonb)'::regprocedure
  );
  if position(v_source_anchor in v_definition) = 0
    or position(v_message_anchor in v_definition) = 0 then
    raise exception 'Не найдены источники длин в функции утверждения замены';
  end if;
  v_definition := replace(v_definition, v_source_anchor, v_source_replacement);
  v_definition := replace(v_definition, v_message_anchor, v_message_replacement);
  execute v_definition;
end;
$migration$;

revoke all on function public.fn_prepare_long_stock_recalculation_replacement_v1(
  text, uuid, uuid, text, numeric[], uuid
) from public, anon, authenticated;
grant execute on function public.fn_prepare_long_stock_recalculation_replacement_v1(
  text, uuid, uuid, text, numeric[], uuid
) to service_role;

revoke all on function public.fn_approve_long_stock_recalculation_replacement_v1(
  uuid, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.fn_approve_long_stock_recalculation_replacement_v1(
  uuid, uuid, jsonb
) to service_role;

notify pgrst, 'reload schema';
