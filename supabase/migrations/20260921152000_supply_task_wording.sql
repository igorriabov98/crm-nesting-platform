-- Preserve the current task generator and all its permission/lifecycle patches.
do $$ declare original text; updated text; begin
 original := pg_get_functiondef('public.activate_supply_start_task(uuid)'::regprocedure);
 updated := replace(replace(original,
 'Забронировать материал со склада и начать обработку заявки: ', 'Обработать заявку: '),
 'Технолог завершил бронь делового остатка. Забронируйте необходимый материал со склада и начните обработку заявки.',
 'Обработайте согласованную заявку и организуйте закупку недостающих материалов.');
 if updated=original then raise exception 'Не найден шаблон задачи снабжения'; end if;
 execute updated;
end $$;

UPDATE public.tasks SET title=replace(title,'Забронировать материал со склада и начать обработку заявки: ','Обработать заявку: '),
 description=case when description='Технолог завершил бронь делового остатка. Забронируйте необходимый материал со склада и начните обработку заявки.' then 'Обработайте согласованную заявку и организуйте закупку недостающих материалов.' else description end,
 updated_at=now() where task_type='supply_start' and status in ('pending','in_progress')
 and title like 'Забронировать материал со склада и начать обработку заявки: %';
