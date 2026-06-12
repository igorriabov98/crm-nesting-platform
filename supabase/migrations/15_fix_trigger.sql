-- 15_fix_trigger.sql

-- Отключаем старый триггер (на всякий случай, если он жив в базе)
DROP TRIGGER IF EXISTS trg_after_machine_insert ON machines;
DROP FUNCTION IF EXISTS fn_create_stages_for_new_machine();

-- Переопределяем триггерную функцию для создания этапов:
-- Теперь все 7 этапов создаются с is_skipped = false, без проверок старых полей (coating, tonnage)
CREATE OR REPLACE FUNCTION trg_create_production_stages()
RETURNS TRIGGER AS $$
BEGIN
    -- Этап 1: Заготовка (cutting). Всегда в Цехе 1.
    INSERT INTO production_stages (machine_id, stage_type, workshop, is_skipped)
    VALUES (NEW.id, 'cutting', 1, false);

    -- Этап 2: Сборка (assembly). Цех на выбор (NULL).
    INSERT INTO production_stages (machine_id, stage_type, is_skipped)
    VALUES (NEW.id, 'assembly', false);

    -- Этап 3: Зачистка (cleaning). Цех на выбор (NULL).
    INSERT INTO production_stages (machine_id, stage_type, is_skipped)
    VALUES (NEW.id, 'cleaning', false);

    -- Этап 4: Цинкование (galvanizing). Цех на выбор (NULL).
    INSERT INTO production_stages (machine_id, stage_type, is_skipped)
    VALUES (NEW.id, 'galvanizing', false); 

    -- Этап 5: Малярка (painting). Всегда в Цехе 2.
    INSERT INTO production_stages (machine_id, stage_type, workshop, is_skipped)
    VALUES (NEW.id, 'painting', 2, false);

    -- Этап 6: Упаковка (packaging). Всегда в Цехе 2.
    INSERT INTO production_stages (machine_id, stage_type, workshop, is_skipped)
    VALUES (NEW.id, 'packaging', 2, false);

    -- Этап 7: Отгрузка (shipping). Без цеха (NULL).
    INSERT INTO production_stages (machine_id, stage_type, is_skipped)
    VALUES (NEW.id, 'shipping', false);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_after_machine_insert
AFTER INSERT ON machines
FOR EACH ROW
EXECUTE FUNCTION trg_create_production_stages();

-- Тот самый триггер валидации из 09 миграции - мы должны убрать проверку coating = 'zinc'
DROP TRIGGER IF EXISTS trg_validate_production_stages ON production_stages;
CREATE OR REPLACE FUNCTION validate_production_stages()
RETURNS TRIGGER AS $$
BEGIN
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

-- Обновляем View, чтобы вес считался в тоннах, так как в item он теперь вводится в кг
DROP VIEW IF EXISTS machines_with_totals CASCADE;
CREATE VIEW machines_with_totals AS
SELECT 
    m.*,
    COALESCE(
        (SELECT SUM(mi.weight * mi.quantity) / 1000 
         FROM machine_items mi 
         WHERE mi.machine_id = m.id), 
        0
    ) AS total_weight,
    COALESCE(
        (SELECT SUM(mi.price * mi.quantity) 
         FROM machine_items mi 
         WHERE mi.machine_id = m.id), 
        0
    ) AS total_items_cost,
    COALESCE(
        (SELECT SUM(me.amount) 
         FROM machine_expenses me 
         WHERE me.machine_id = m.id), 
        0
    ) AS total_expenses,
    COALESCE(
        (SELECT SUM(mi.price * mi.quantity) 
         FROM machine_items mi 
         WHERE mi.machine_id = m.id), 
        0
    ) + COALESCE(
        (SELECT SUM(me.amount) 
         FROM machine_expenses me 
         WHERE me.machine_id = m.id), 
        0
    ) AS total_cost,
    COALESCE(
        (SELECT COUNT(mi.id) 
         FROM machine_items mi 
         WHERE mi.machine_id = m.id), 
        0
    ) AS item_count,
    EXISTS (
        SELECT 1 FROM machine_items mi 
        WHERE mi.machine_id = m.id AND mi.coating = 'zinc'
    ) AS has_zinc,
    EXISTS (
        SELECT 1 FROM machine_items mi 
        WHERE mi.machine_id = m.id AND mi.coating = 'powder_coating'
    ) AS has_painting
FROM machines m;

