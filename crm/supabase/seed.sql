-- Тестовые данные для демонстрации CRM
-- Выполнить ПОСЛЕ применения миграций

-- Очистка таблиц (только для тестирования!)
TRUNCATE TABLE notifications CASCADE;
TRUNCATE TABLE invoices CASCADE;
TRUNCATE TABLE supply_items CASCADE;
TRUNCATE TABLE production_blocks CASCADE;
TRUNCATE TABLE machines CASCADE;

-- Если таблицы заводов пустые, заполним:
INSERT INTO factories (name) 
SELECT 'Ужгород' WHERE NOT EXISTS (SELECT 1 FROM factories WHERE name = 'Ужгород');
INSERT INTO factories (name) 
SELECT 'Берегово' WHERE NOT EXISTS (SELECT 1 FROM factories WHERE name = 'Берегово');

-- Для удобства, возьмём первый попавшийся User для `created_by` (принято, что хотя бы 1 админ уже создан).
-- Если нет юзеров, создадим технического админа (password = admin).
DO $$
DECLARE
    f_uzhgorod UUID;
    f_beregovo UUID;
    admin_id UUID;
    
    m1_id UUID := gen_random_uuid();
    m2_id UUID := gen_random_uuid();
    m3_id UUID := gen_random_uuid();
    m4_id UUID := gen_random_uuid();
    m5_id UUID := gen_random_uuid();
    m6_id UUID := gen_random_uuid();
    m7_id UUID := gen_random_uuid();
    m8_id UUID := gen_random_uuid();
BEGIN
    SELECT id INTO f_uzhgorod FROM factories WHERE name = 'Ужгород' LIMIT 1;
    SELECT id INTO f_beregovo FROM factories WHERE name = 'Берегово' LIMIT 1;
    
    SELECT id INTO admin_id FROM users LIMIT 1;

    -- Если нет юзера, миграции или seed остановятся? Предполагаем, что юзер создан (Шаг 5 инструкции).
    -- Если admin_id IS NULL:
    -- Для этого seed мы просто зашьем NULL в created_by, если Foreign Key позволяет (Foreign key usually ON DELETE SET NULL).
    
    -- --- МАШИНЫ ---
    INSERT INTO machines (id, factory_id, external_id, name, product, tonnage, coating, ral_number, comment, created_by) VALUES
    (m1_id, f_uzhgorod, 'B-24-001', 'Балка Б-24 (Кран)', 'Мостовая металлоконструкция', 24.5, 'zinc', NULL, 'Приоритет 1', admin_id),
    (m2_id, f_uzhgorod, 'FS-12-002', 'Ферма ФС-12', 'Кровельная ферма', 12.0, 'powder_coating', '9005', 'Черный матовый', admin_id),
    (m3_id, f_uzhgorod, 'K-8-003', 'Колонна К-8', 'Опорная колонна', 8.2, 'none', NULL, '', admin_id),
    (m4_id, f_beregovo, 'P-15-004', 'Портал П-15', 'Входная группа', 15.0, 'zinc', NULL, '', admin_id),
    (m5_id, f_beregovo, 'B-30-005', 'Балка Б-30 (Двойная)', 'Несущая балка', 30.0, 'powder_coating', '7024', 'Графит', admin_id),
    (m6_id, f_uzhgorod, 'C-5-006', 'Связи С-5', 'Ветровые связи', 5.5, 'none', NULL, '', admin_id),
    (m7_id, f_beregovo, 'M-2-007', 'Мачта М-2', 'Осветительная мачта', 2.0, 'zinc', NULL, 'Уличная эксплуатация', admin_id),
    (m8_id, f_uzhgorod, 'O-4-008', 'Ограждения О-4', 'Перильные ограждения', 4.1, 'powder_coating', '5002', 'Синий ультрамарин', admin_id);

    -- --- ЭТАПЫ ПРОИЗВОДСТВА (production_blocks) ---
    -- Балка Б-24 (полностью завершена)
    INSERT INTO production_blocks (machine_id, stage_id, status, plan_start_date, plan_end_date, fact_start_date, fact_end_date) VALUES 
    (m1_id, 'milling', 'completed', now() - interval '10 days', now() - interval '8 days', now() - interval '10 days', now() - interval '9 days'),
    (m1_id, 'welding', 'completed', now() - interval '8 days', now() - interval '5 days', now() - interval '8 days', now() - interval '5 days'),
    (m1_id, 'zinc', 'completed', now() - interval '4 days', now() - interval '2 days', now() - interval '4 days', now() - interval '2 days'),
    (m1_id, 'logistics', 'completed', now() - interval '1 day', now() + interval '1 day', now() - interval '1 day', now());

    -- Ферма ФС-12 (в работе, без просрочек)
    INSERT INTO production_blocks (machine_id, stage_id, status, plan_start_date, plan_end_date, fact_start_date) VALUES 
    (m2_id, 'cutting', 'completed', now() - interval '5 days', now() - interval '3 days', now() - interval '5 days'),
    (m2_id, 'assembling', 'in_progress', now() - interval '2 days', now() + interval '3 days', now() - interval '2 days'),
    (m2_id, 'painting', 'planned', now() + interval '4 days', now() + interval '6 days', NULL);

    -- Колонна К-8 (ПРОСРОЧЕНА сборка)
    INSERT INTO production_blocks (machine_id, stage_id, status, plan_start_date, plan_end_date, fact_start_date) VALUES 
    (m3_id, 'cutting', 'completed', now() - interval '15 days', now() - interval '12 days', now() - interval '15 days'),
    (m3_id, 'welding', 'in_progress', now() - interval '10 days', now() - interval '2 days', now() - interval '8 days'); -- end date is past!!

    -- Портал П-15 (в работе)
    INSERT INTO production_blocks (machine_id, stage_id, status, plan_start_date, plan_end_date, fact_start_date) VALUES 
    (m4_id, 'drilling', 'in_progress', now() - interval '1 day', now() + interval '2 days', now() - interval '1 day');

    -- --- ПОЗИЦИИ СНАБЖЕНИЯ (supply_items) ---
    INSERT INTO supply_items (machine_id, nomenclature, plan_qty, uom, status, plan_date, supplier) VALUES 
    (m1_id, 'Двутавр 40К1', 2, 'т', 'received', now() - interval '15 days', 'Метинвест'),
    (m1_id, 'Двутавр 35Б2', 1.5, 'т', 'received', now() - interval '14 days', 'Метинвест'),
    
    (m2_id, 'Профильная труба 100х100х5', 8, 'т', 'received', now() - interval '5 days', 'СлавСантех'),
    (m2_id, 'Болты анкерные М24', 50, 'шт', 'ordered', now() + interval '1 day', 'Метиз Днепр'),
    (m2_id, 'Порошковая краска RAL 9005', 40, 'кг', 'not_ordered', now() + interval '3 days', NULL),
    
    (m3_id, 'Лист горячекатаный 20мм', 5, 'т', 'ordered', now() - interval '1 day', 'Азовсталь'), -- expected yesterday! (overdue supply)
    (m3_id, 'Уголок 75х75х6', 1.2, 'т', 'ordered', now() + interval '2 days', 'Метинвест'),

    (m4_id, 'Швеллер 20П', 3, 'т', 'not_ordered', now() + interval '10 days', NULL),
    (m5_id, 'Труба круглая 159х6', 6, 'т', 'received', now() - interval '2 days', 'Тобома'),
    (m5_id, 'Монтажные пластины', 120, 'шт', 'not_ordered', now() + interval '5 days', NULL);

    -- --- ИНВОЙСЫ (invoices) ---
    -- м1 завершена -> есть инвойс (Оплачен)
    INSERT INTO invoices (machine_id, amount, payment_date, status, created_by) VALUES
    (m1_id, 1250000.00, now() - interval '2 days', 'paid', admin_id);

    -- м2 -> Ожидает
    INSERT INTO invoices (machine_id, amount, payment_date, status, created_by) VALUES
    (m2_id, 450000.00, now() + interval '10 days', 'pending', admin_id);

    -- м3 -> Просрочен (Pending and date is past)
    INSERT INTO invoices (machine_id, amount, payment_date, status, created_by) VALUES
    (m3_id, 230000.00, now() - interval '3 days', 'pending', admin_id);

    -- --- УВЕДОМЛЕНИЯ (notifications) ---
    -- Создаем пару уведомлений для админа
    IF admin_id IS NOT NULL THEN
        INSERT INTO notifications (user_id, related_machine_id, type, title, message, is_read, created_at) VALUES
        (admin_id, m3_id, 'stage_overdue', 'Просрочка этапа [Сварка]', 'Сборка Колонны К-8 просрочена на 2 дня.', false, now() - interval '2 hours'),
        (admin_id, m3_id, 'supply_overdue', 'Задержка поставки [Лист 20мм]', 'Поставщик Азовсталь задерживает отгрузку.', false, now() - interval '5 hours'),
        (admin_id, m1_id, 'invoice_created', 'Новый инвойс выставлен', 'Инвойс на Балку Б-24 ожидает оплаты.', true, now() - interval '3 days'),
        (admin_id, m1_id, 'machine_shipped', 'Машина отгружена: Б-24', 'Логистика завершена успешно.', true, now() - interval '1 day'),
        (admin_id, m2_id, 'new_machine', 'Запланирована новая машина', 'Добавлена Ферма ФС-12.', true, now() - interval '15 days');
    END IF;

END $$;
