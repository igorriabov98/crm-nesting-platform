do $migration$
declare
  v_signature regprocedure := 'public.fn_approve_long_stock_cutting_plan_version_v1(uuid,uuid)'::regprocedure;
  v_before text;
  v_after text;
  v_old_guard constant text := $guard$if not found or not v_candidate.is_complete then
    raise exception 'Выбранный вариант должен быть полным';
  end if;$guard$;
  v_new_guard constant text := $guard$if not found then
    raise exception 'Выбранный вариант не найден';
  end if;$guard$;
begin
  v_before := pg_get_functiondef(v_signature);
  v_after := replace(v_before, v_old_guard, v_new_guard);
  if v_after = v_before then
    raise exception 'Не найден guard полноты в fn_approve_long_stock_cutting_plan_version_v1';
  end if;
  execute v_after;
end;
$migration$;

do $migration$
declare
  v_signature regprocedure := 'public.fn_set_long_stock_cutting_plan_version_status(uuid,text,uuid,text,uuid)'::regprocedure;
  v_before text;
  v_after text;
  v_old_guard constant text := $guard$and candidate.is_complete
        and exists ($guard$;
  v_new_guard constant text := $guard$and exists ($guard$;
begin
  v_before := pg_get_functiondef(v_signature);
  v_after := replace(v_before, v_old_guard, v_new_guard);
  v_after := replace(
    v_after,
    'Выбранный вариант должен быть полным и содержать хлысты',
    'Выбранный вариант должен содержать хлысты'
  );
  if v_after = v_before then
    raise exception 'Не найден guard полноты в fn_set_long_stock_cutting_plan_version_status';
  end if;
  execute v_after;
end;
$migration$;

comment on function public.fn_approve_long_stock_cutting_plan_version_v1(uuid, uuid) is
  'Утверждает выбранную серверно валидированную раскладку; признак полноты поиска не блокирует утверждение.';
