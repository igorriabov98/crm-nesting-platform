\set ON_ERROR_STOP on

begin;

do $$
declare
  v_factory uuid;
  v_other_factory uuid;
  v_actor uuid := '94000000-0000-4000-8000-000000000001';
  v_parent uuid := '94000000-0000-4000-8000-000000000002';
  v_section uuid := '94000000-0000-4000-8000-000000000003';
  v_paint_parent uuid := '94000000-0000-4000-8000-000000000004';
  v_paint_section uuid := '94000000-0000-4000-8000-000000000005';
  v_machine uuid := '94000000-0000-4000-8000-000000000006';
  v_machine_2 uuid := '94000000-0000-4000-8000-000000000007';
  v_other_machine uuid := '94000000-0000-4000-8000-000000000008';
  v_item uuid := '94000000-0000-4000-8000-000000000009';
  v_item_2 uuid := '94000000-0000-4000-8000-000000000010';
  v_zinc_item uuid := '94000000-0000-4000-8000-000000000011';
  v_other_item uuid := '94000000-0000-4000-8000-000000000012';
  v_fact uuid;
  v_fact_2 uuid;
  v_value numeric;
  v_source text;
begin
  select id into strict v_factory from public.factories order by created_at, id limit 1;
  select id into strict v_other_factory from public.factories where id <> v_factory order by created_at, id limit 1;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, 'production-analytics@example.test', 'Production Analytics Test', 'production_manager', v_factory, true);
  insert into public.production_fact_sections(id, factory_id, parent_id, name, production_stage_type, created_by, updated_by)
  values
    (v_parent, v_factory, null, 'Сборка тест', 'assembly', v_actor, v_actor),
    (v_section, v_factory, v_parent, 'Цех 94', 'assembly', v_actor, v_actor),
    (v_paint_parent, v_factory, null, 'Малярка тест', 'painting', v_actor, v_actor),
    (v_paint_section, v_factory, v_paint_parent, 'Малярка 94', 'painting', v_actor, v_actor);
  insert into public.machines(id, factory_id, name, created_by) values
    (v_machine, v_factory, 'PRODUCTION-ANALYTICS-1', v_actor),
    (v_machine_2, v_factory, 'PRODUCTION-ANALYTICS-2', v_actor),
    (v_other_machine, v_other_factory, 'PRODUCTION-ANALYTICS-OTHER', v_actor);
  insert into public.machine_items(id, machine_id, drawing_number, product_name, weight, price, quantity, coating, sort_order)
  values
    (v_item, v_machine, 'A-1', 'Порошковая позиция', 2.5, 0, 10, 'powder_coating', 1),
    (v_zinc_item, v_machine, 'A-2', 'Цинковая позиция', 3, 0, 5, 'zinc', 2),
    (v_item_2, v_machine_2, 'B-1', 'Вторая позиция', 4, 0, 10, 'powder_coating', 1),
    (v_other_item, v_other_machine, 'C-1', 'Чужая позиция', 1, 0, 10, 'powder_coating', 1);

  v_fact := (public.fn_save_production_machine_item_fact_v1(
    v_factory, '2026-09-01', 'day', v_machine, v_section, 'assembly',
    jsonb_build_array(jsonb_build_object('machine_item_id', v_item, 'quantity', 4)), null, v_actor
  )->>'fact_id')::uuid;
  if (select count(*) from public.production_machine_item_facts where production_machine_fact_id = v_fact) <> 1 then
    raise exception 'Initial item fact was not saved';
  end if;
  select tonnage, source into v_value, v_source from public.production_tonnage_facts
  where factory_id = v_factory and fact_date = '2026-09-01' and section_id = v_section;
  if v_value <> 0.010 or v_source <> 'itemized' then raise exception 'Initial tonnage is incorrect: %, %', v_value, v_source; end if;

  perform public.fn_save_production_machine_item_fact_v1(
    v_factory, '2026-09-01', 'day', v_machine, v_section, 'assembly',
    jsonb_build_array(jsonb_build_object('machine_item_id', v_item, 'quantity', 3)), 'replacement', v_actor
  );
  if (select quantity from public.production_machine_item_facts where production_machine_fact_id = v_fact) <> 3 then
    raise exception 'Repeated save must replace the shift total';
  end if;

  v_fact_2 := (public.fn_save_production_machine_item_fact_v1(
    v_factory, '2026-09-01', 'day', v_machine_2, v_section, 'assembly',
    jsonb_build_array(jsonb_build_object('machine_item_id', v_item_2, 'quantity', 2)), null, v_actor
  )->>'fact_id')::uuid;
  select tonnage into v_value from public.production_tonnage_facts
  where factory_id = v_factory and fact_date = '2026-09-01' and section_id = v_section;
  if v_value <> 0.016 then raise exception 'Atomic section aggregate is incorrect: %', v_value; end if;

  perform public.fn_save_production_machine_item_fact_v1(
    v_factory, '2026-09-02', 'night', v_machine, v_section, 'assembly',
    jsonb_build_array(jsonb_build_object('machine_item_id', v_item, 'quantity', 7)), null, v_actor
  );
  begin
    perform public.fn_save_production_machine_item_fact_v1(
      v_factory, '2026-09-03', 'day', v_machine, v_section, 'assembly',
      jsonb_build_array(jsonb_build_object('machine_item_id', v_item, 'quantity', 1)), null, v_actor
    );
    raise exception 'Expected quantity overflow';
  exception when others then
    if sqlerrm not like '%Количество превышает остаток по этапу%' then raise; end if;
  end;

  begin
    perform public.fn_save_production_machine_item_fact_v1(
      v_factory, '2026-09-03', 'day', v_machine, v_section, 'assembly',
      jsonb_build_array(jsonb_build_object('machine_item_id', v_other_item, 'quantity', 1)), null, v_actor
    );
    raise exception 'Expected wrong-order rejection';
  exception when others then
    if sqlerrm not like '%Номенклатура или количество заполнены некорректно%' then raise; end if;
  end;

  begin
    perform public.fn_save_production_machine_item_fact_v1(
      v_factory, '2026-09-03', 'day', v_machine, v_paint_section, 'painting',
      jsonb_build_array(jsonb_build_object('machine_item_id', v_zinc_item, 'quantity', 1)), null, v_actor
    );
    raise exception 'Expected painting-coating rejection';
  exception when others then
    if sqlerrm not like '%Номенклатура или количество заполнены некорректно%' then raise; end if;
  end;

  insert into public.production_tonnage_facts(factory_id, fact_date, section_id, tonnage, source, created_by, updated_by)
  values (v_factory, '2026-09-04', v_paint_section, 1.234, 'legacy_manual', v_actor, v_actor);
  begin
    perform public.fn_save_production_machine_item_fact_v1(
      v_factory, '2026-09-04', 'day', v_machine, v_paint_section, 'painting',
      jsonb_build_array(jsonb_build_object('machine_item_id', v_item, 'quantity', 1)), null, v_actor
    );
    raise exception 'Expected legacy aggregate rejection';
  exception when others then
    if sqlerrm not like '%исторический ручной тоннаж%' then raise; end if;
  end;
  if (select source from public.production_tonnage_facts where factory_id = v_factory and fact_date = '2026-09-04' and section_id = v_paint_section) <> 'legacy_manual' then
    raise exception 'Legacy aggregate must remain unchanged';
  end if;

  perform public.fn_delete_production_machine_item_fact_v1(v_fact, v_actor);
  select tonnage into v_value from public.production_tonnage_facts
  where factory_id = v_factory and fact_date = '2026-09-01' and section_id = v_section;
  if v_value <> 0.008 then raise exception 'Delete did not recalculate the section aggregate: %', v_value; end if;
  if not exists (select 1 from public.production_machine_facts where id = v_fact_2) then
    raise exception 'Delete removed another order fact';
  end if;

  insert into public.production_section_capacity_periods(factory_id, section_id, valid_from, valid_to, tons_per_workday, created_by, updated_by)
  values (v_factory, v_section, '2026-09-01', '2026-09-30', 5, v_actor, v_actor);
  begin
    insert into public.production_section_capacity_periods(factory_id, section_id, valid_from, valid_to, tons_per_workday, created_by, updated_by)
    values (v_factory, v_section, '2026-09-30', null, 6, v_actor, v_actor);
    raise exception 'Expected overlapping-capacity rejection';
  exception when others then
    if sqlerrm not like '%не должны пересекаться%' then raise; end if;
  end;

  if has_function_privilege('authenticated', 'public.fn_save_production_machine_item_fact_v1(uuid,date,public.production_fact_shift,uuid,uuid,public.stage_type,jsonb,text,uuid)', 'EXECUTE') then
    raise exception 'Authenticated role must not execute item-fact RPC directly';
  end if;
end;
$$;

rollback;
