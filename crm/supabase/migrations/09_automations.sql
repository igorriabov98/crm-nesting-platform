-- 09_automations.sql
-- Инфраструктура автоматизации: триггеры, серверные расчёты и бизнес-валидация

-- 1. Добавление недостающего планировочного поля (требуется для расчётов)
ALTER TABLE production_stages ADD COLUMN IF NOT EXISTS planned_date_end DATE;

-------------------------------------------------------------------------------------
-- 2. ТРИГГЕР: АВТОСОЗДАНИЕ 7 ЭТАПОВ ПРОИЗВОДСТВА
-------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_create_production_stages()
RETURNS TRIGGER AS $$
BEGIN
    -- Этап 1: Заготовка (cutting). Всегда в Цехе 1.
    INSERT INTO production_stages (machine_id, stage_type, workshop)
    VALUES (NEW.id, 'cutting', 1);

    -- Этап 2: Сборка (assembly). Цех на выбор (NULL).
    INSERT INTO production_stages (machine_id, stage_type)
    VALUES (NEW.id, 'assembly');

    -- Этап 3: Зачистка (cleaning). Цех на выбор (NULL).
    INSERT INTO production_stages (machine_id, stage_type)
    VALUES (NEW.id, 'cleaning');

    -- Этап 4: Цинкование (galvanizing). Цех на выбор (NULL).
    -- Бизнес логика: если покрытие машины цинк - блок пропуска. В ином случае ставим skip=false по умолчанию для решения цеха.
    INSERT INTO production_stages (machine_id, stage_type, is_skipped)
    VALUES (NEW.id, 'galvanizing', false); 

    -- Этап 5: Малярка (painting). Всегда в Цехе 2.
    INSERT INTO production_stages (machine_id, stage_type, workshop)
    VALUES (NEW.id, 'painting', 2);

    -- Этап 6: Упаковка (packaging). Всегда в Цехе 2.
    INSERT INTO production_stages (machine_id, stage_type, workshop)
    VALUES (NEW.id, 'packaging', 2);

    -- Этап 7: Отгрузка (shipping). Без цеха (NULL).
    INSERT INTO production_stages (machine_id, stage_type)
    VALUES (NEW.id, 'shipping');

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_after_machine_insert
AFTER INSERT ON machines
FOR EACH ROW
EXECUTE FUNCTION trg_create_production_stages();

-------------------------------------------------------------------------------------
-- 3. ТРИГГЕР: ВАЛИДАЦИЯ БИЗНЕС-ПРАВИЛ ДЛЯ ЭТАПОВ ПЛАНИРОВАНИЯ
-------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_production_stages()
RETURNS TRIGGER AS $$
DECLARE
    v_coating coating_type;
BEGIN
    -- Для правил нужен внешний контекст (получаем покрытие из таблицы машин)
    SELECT coating INTO v_coating FROM machines WHERE id = NEW.machine_id;

    -- a) Нельзя пропустить galvanizing если coating = 'zinc'
    IF NEW.stage_type = 'galvanizing' AND NEW.is_skipped = true AND v_coating = 'zinc' THEN
        RAISE EXCEPTION 'Бизнес-правило: нельзя пропустить этап цинкования (galvanizing) если покрытие машины = zinc.';
    END IF;

    -- b) Нельзя изменить workshop для cutting (всегда 1)
    IF NEW.stage_type = 'cutting' AND NEW.workshop IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'Бизнес-правило: цех для заготовки (cutting) всегда должен быть 1.';
    END IF;

    -- c) Нельзя изменить workshop для painting или packaging (всегда 2)
    IF NEW.stage_type IN ('painting', 'packaging') AND NEW.workshop IS DISTINCT FROM 2 THEN
        RAISE EXCEPTION 'Бизнес-правило: цех для малярки и упаковки (painting, packaging) всегда должен быть 2.';
    END IF;

    -- d) date_end не может быть раньше date_start
    IF NEW.date_end IS NOT NULL AND NEW.date_start IS NOT NULL AND NEW.date_end < NEW.date_start THEN
        RAISE EXCEPTION 'Бизнес-правило: дата окончания этапа (date_end) не может быть раньше даты начала (date_start).';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_production_stages
BEFORE INSERT OR UPDATE ON production_stages
FOR EACH ROW
EXECUTE FUNCTION validate_production_stages();

-------------------------------------------------------------------------------------
-- 4. ТРИГГЕР: АВТОСОЗДАНИЕ ИНВОЙСОВ
-------------------------------------------------------------------------------------
-- Этот триггер полностью берет на себя ответственность за инвойсы, дополняя старую логику из миграции 06
DROP TRIGGER IF EXISTS trg_update_payment_date_from_shipping ON production_stages;
DROP FUNCTION IF EXISTS update_invoice_payment_date();

CREATE OR REPLACE FUNCTION trg_upsert_invoice_on_shipping()
RETURNS TRIGGER AS $$
DECLARE
    v_amount decimal;
BEGIN
    -- Инвойс генерируется ТОЛЬКО в момент фактической отгрузки (есть конечная дата у shipping)
    IF NEW.stage_type = 'shipping' AND NEW.date_end IS NOT NULL THEN
        
        -- Стянуть сумму из основной заявки (сработает быстро благодаря индексам)
        SELECT invoice_amount INTO v_amount FROM machines WHERE id = NEW.machine_id;
        
        -- Выполняем UPSERT с разрешением конфликтов. 
        INSERT INTO invoices (machine_id, amount, payment_date, status)
        VALUES (NEW.machine_id, COALESCE(v_amount, 0), NEW.date_end + 14, 'not_paid')
        ON CONFLICT (machine_id) DO UPDATE 
        SET payment_date = EXCLUDED.payment_date,
            status = CASE 
                        WHEN invoices.status IN ('paid') THEN invoices.status 
                        ELSE invoices.status -- Если уже overdue, пусть им и остается пока не оплатят
                     END;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_after_shipping_update
AFTER UPDATE OF date_end ON production_stages
FOR EACH ROW
WHEN (NEW.stage_type = 'shipping' AND NEW.date_end IS NOT NULL)
EXECUTE FUNCTION trg_upsert_invoice_on_shipping();

-------------------------------------------------------------------------------------
-- 5. ТРИГГЕР ПЕРЕСЧЕТА ДЕДЛАЙНОВ (Комментарий)
-------------------------------------------------------------------------------------
-- Проверено: триггер trg_calc_supply_deadlines (создан в миграции 05_supply_items.sql) корректно работает:
-- NEW.technologist_deadline := NEW.planned_delivery_date - 10;
-- NEW.engineer_deadline := NEW.technologist_deadline - 2;

-------------------------------------------------------------------------------------
-- 6. VIEW: supply_items_with_overdue
-------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW supply_items_with_overdue AS
SELECT 
    si.*,
    -- Условие: просрочка если сегодня > дня доставки и товар не отмечался как полученный
    (CURRENT_DATE > si.planned_delivery_date AND si.status != 'received') AS is_overdue
FROM supply_items si;

-------------------------------------------------------------------------------------
-- 7. VIEW: production_stages_with_delay
-------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW production_stages_with_delay AS
SELECT 
    ps.*,
    -- production delay: Разница факта с планом только если есть отклонение (> 0)
    CASE 
        WHEN ps.date_end IS NOT NULL AND ps.planned_date_end IS NOT NULL AND ps.date_end > ps.planned_date_end THEN
            (ps.date_end - ps.planned_date_end)
        ELSE 0
    END AS delay_days,
    
    -- production overdue: Факта (end) еще нет, а план (planned_date_end) прошел
    (ps.date_end IS NULL AND ps.planned_date_end IS NOT NULL AND CURRENT_DATE > ps.planned_date_end) AS is_overdue
FROM production_stages ps;

-------------------------------------------------------------------------------------
-- 8. ФУНКЦИЯ ПРОВЕРКИ УСТАРЕВАНИЯ (CRON EXTENDED / EDGE FUNCTION)
-------------------------------------------------------------------------------------
-- Функция должна вызываться ежесуточно планировщиком (провайдером pg_cron или внешним скриптом)
CREATE OR REPLACE FUNCTION check_daily_invoices_overdue()
RETURNS void AS $$
BEGIN
    UPDATE invoices
    SET status = 'overdue'
    WHERE status = 'not_paid' 
      AND payment_date IS NOT NULL 
      AND CURRENT_DATE > payment_date;
      
    -- Генерация уведомлений может быть привязана к этому же событию в будущем
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
