-- 10_notification_triggers.sql
-- Инфраструктура триггеров и функций для оповещений системы

-------------------------------------------------------------------------------------
-- 1. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (УТИЛИТЫ ОТПРАВКИ)
-------------------------------------------------------------------------------------

-- Функция для массовой отправки уведомлений по роли в рамках завода
CREATE OR REPLACE FUNCTION notify_by_role(
  p_factory_id uuid,
  p_role user_role,
  p_type text,
  p_title text,
  p_message text,
  p_machine_id uuid DEFAULT NULL
) RETURNS void AS $$
BEGIN
  INSERT INTO notifications (user_id, type, title, message, related_machine_id)
  SELECT id, p_type, p_title, p_message, p_machine_id
  FROM users
  WHERE factory_id = p_factory_id
    AND role = p_role
    AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Вспомогательная функция: уведомление конкретному пользователю
CREATE OR REPLACE FUNCTION notify_user(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_machine_id uuid DEFAULT NULL
) RETURNS void AS $$
BEGIN
  IF p_user_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, type, title, message, related_machine_id)
    VALUES (p_user_id, p_type, p_title, p_message, p_machine_id);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Вспомогательная функция: уведомление всем директорам завода
CREATE OR REPLACE FUNCTION notify_all_directors(
  p_factory_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_machine_id uuid DEFAULT NULL
) RETURNS void AS $$
BEGIN
  INSERT INTO notifications (user_id, type, title, message, related_machine_id)
  SELECT id, p_type, p_title, p_message, p_machine_id
  FROM users
  WHERE factory_id = p_factory_id
    AND role IN ('planning_director', 'financial_director', 'commercial_director')
    AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-------------------------------------------------------------------------------------
-- 2. ТРИГГЕРЫ БД (МГНОВЕННЫЕ УВЕДОМЛЕНИЯ ПРИ СОБЫТИЯХ)
-------------------------------------------------------------------------------------

-- Триггер: новая машина → уведомление инженерам и нач. производства
CREATE OR REPLACE FUNCTION notify_on_new_machine()
RETURNS TRIGGER AS $$
BEGIN
  -- Уведомляем инженеров завода (1)
  PERFORM notify_by_role(NEW.factory_id, 'engineer', 'новая_машина', 'Новая машина', 'Машина ' || NEW.name || ' — нужно подтверждение чертежа', NEW.id);
  -- Уведомляем начальников производства (2)
  PERFORM notify_by_role(NEW.factory_id, 'production_manager', 'новая_машина', 'Новая машина', 'Машина ' || NEW.name || ' — запланируйте этапы производства', NEW.id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notify_new_machine
AFTER INSERT ON machines
FOR EACH ROW
EXECUTE FUNCTION notify_on_new_machine();


-- Триггер: обновление supply_items (инженер подтвердил / технолог внес)
CREATE OR REPLACE FUNCTION notify_on_supply_items_update()
RETURNS TRIGGER AS $$
DECLARE
  v_machine_name text;
  v_factory_id uuid;
BEGIN
  -- Получаем реквизиты машины
  SELECT name, factory_id INTO v_machine_name, v_factory_id FROM machines WHERE id = NEW.machine_id;

  -- (3) Инженер подтвердил
  IF NEW.engineer_confirmation = true AND OLD.engineer_confirmation = false THEN
    PERFORM notify_by_role(v_factory_id, 'technologist', 'подтверждение_чертежа', 'Чертёж подтверждён', 'Чертёж подтверждён для ' || v_machine_name || ' — внесите номенклатуру', NEW.machine_id);
  END IF;

  -- (4) Технолог внес (nomenclature стала НЕ NULL)
  IF NEW.nomenclature IS NOT NULL AND OLD.nomenclature IS NULL THEN
    PERFORM notify_by_role(v_factory_id, 'supply_manager', 'номенклатура_внесена', 'Номенклатура готова', 'Номенклатура готова для ' || v_machine_name || ' — оформите заказ', NEW.machine_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notify_supply_update
AFTER UPDATE ON supply_items
FOR EACH ROW
EXECUTE FUNCTION notify_on_supply_items_update();


-- Триггер: отгрузка завершена → уведомление sales + финансовому
CREATE OR REPLACE FUNCTION notify_on_shipping_complete()
RETURNS TRIGGER AS $$
DECLARE
  v_machine_name text;
  v_creator_id uuid;
  v_factory_id uuid;
  v_payment_date date;
  v_amount decimal;
BEGIN
  -- Действуем только для этапа отгрузки при изменении даты конца
  IF NEW.stage_type = 'shipping' AND NEW.date_end IS NOT NULL AND OLD.date_end IS NULL THEN
    
    SELECT name, created_by, factory_id, invoice_amount 
    INTO v_machine_name, v_creator_id, v_factory_id, v_amount
    FROM machines WHERE id = NEW.machine_id;

    v_payment_date := NEW.date_end + 14;

    -- (10) Уведомление создателю (sales_manager)
    PERFORM notify_user(v_creator_id, 'отгрузка_завершена', 'Машина отгружена', 'Машина ' || v_machine_name || ' отгружена — инвойс создан, оплата до ' || v_payment_date, NEW.machine_id);

    -- (11) Уведомление финансовому
    PERFORM notify_by_role(v_factory_id, 'financial_director', 'новый_инвойс', 'Новый инвойс', 'Новый инвойс на сумму ' || COALESCE(v_amount, 0) || ' по машине ' || v_machine_name || ', оплата до ' || v_payment_date, NEW.machine_id);

  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notify_shipping
AFTER UPDATE OF date_end ON production_stages
FOR EACH ROW
EXECUTE FUNCTION notify_on_shipping_complete();


-------------------------------------------------------------------------------------
-- 3. ЕЖЕДНЕВНАЯ ФУНКЦИЯ ДЛЯ CRON (ДЕДЛАЙНЫ И ПРОСРОЧКИ)
-------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION check_daily_notifications()
RETURNS void AS $$
DECLARE
  rec record;
BEGIN

  -- A) ПРОВЕРКИ МАССИВА СНАБЖЕНИЯ (Supply)
  FOR rec IN
    SELECT si.*, m.name as machine_name, m.factory_id 
    FROM supply_items si
    JOIN machines m ON si.machine_id = m.id
  LOOP
    -- 1. За 2 дня до дедлайна инженера (если еще не подтверждено) (5)
    IF rec.engineer_deadline IS NOT NULL AND rec.engineer_confirmation = false 
       AND (rec.engineer_deadline - CURRENT_DATE) = 2 THEN
       IF NOT EXISTS (SELECT 1 FROM notifications WHERE type='dedline_eng' AND related_machine_id=rec.machine_id AND DATE(created_at) = CURRENT_DATE) THEN
         PERFORM notify_by_role(rec.factory_id, 'engineer', 'dedline_eng', 'Дедлайн приближается', 'До дедлайна подтверждения чертежа для ' || rec.machine_name || ' осталось 2 дня', rec.machine_id);
       END IF;
    END IF;

    -- 2. За 2 дня до дедлайна технолога (если еще нет номенклатуры) (6)
    IF rec.technologist_deadline IS NOT NULL AND rec.nomenclature IS NULL 
       AND (rec.technologist_deadline - CURRENT_DATE) = 2 THEN
       IF NOT EXISTS (SELECT 1 FROM notifications WHERE type='dedline_tech' AND related_machine_id=rec.machine_id AND DATE(created_at) = CURRENT_DATE) THEN
         PERFORM notify_by_role(rec.factory_id, 'technologist', 'dedline_tech', 'Дедлайн приближается', 'До дедлайна номенклатуры для ' || rec.machine_name || ' осталось 2 дня', rec.machine_id);
       END IF;
    END IF;

    -- 3 & 4. За 2 дня до поставки и просрочка поставки (Снабжение) (7, 8)
    IF rec.status != 'received' AND rec.planned_delivery_date IS NOT NULL THEN
       -- Осталось 2 дня
       IF (rec.planned_delivery_date - CURRENT_DATE) = 2 THEN
         IF NOT EXISTS (SELECT 1 FROM notifications WHERE type='dedline_supply' AND related_machine_id=rec.machine_id AND DATE(created_at) = CURRENT_DATE) THEN
           PERFORM notify_by_role(rec.factory_id, 'supply_manager', 'dedline_supply', 'Дедлайн поставки', 'До дедлайна поставки ' || COALESCE(rec.nomenclature, 'позиции') || ' для ' || rec.machine_name || ' осталось 2 дня', rec.machine_id);
         END IF;
       END IF;

       -- Просрочено
       IF CURRENT_DATE > rec.planned_delivery_date THEN
         IF NOT EXISTS (SELECT 1 FROM notifications WHERE type='overdue_supply' AND related_machine_id=rec.machine_id AND DATE(created_at) = CURRENT_DATE) THEN
           -- Уведомляем снабжение
           PERFORM notify_by_role(rec.factory_id, 'supply_manager', 'overdue_supply', 'Просрочка поставки', 'Материал ' || COALESCE(rec.nomenclature, 'не указан') || ' просрочен для ' || rec.machine_name, rec.machine_id);
           -- Уведомляем всех директоров
           PERFORM notify_all_directors(rec.factory_id, 'overdue_supply', 'Просрочка поставки', 'Материал ' || COALESCE(rec.nomenclature, 'не указан') || ' просрочен для ' || rec.machine_name, rec.machine_id);
         END IF;
       END IF;
    END IF;
  END LOOP;

  -- B) ПРОСРОЧКИ ЭТАПОВ ПРОИЗВОДСТВА (9)
  FOR rec IN
    SELECT ps.*, m.name as machine_name, m.factory_id 
    FROM production_stages ps
    JOIN machines m ON ps.machine_id = m.id
    WHERE ps.date_end IS NULL AND ps.planned_date_end IS NOT NULL
      AND CURRENT_DATE > ps.planned_date_end
  LOOP
    -- Используем stage_type в WHERE, чтобы не плодить 1 общую нотификацию на все просроченные этапы одной машины
    IF NOT EXISTS (SELECT 1 FROM notifications WHERE type='overdue_prod' AND related_machine_id=rec.machine_id AND message LIKE '%'||rec.stage_type||'%' AND DATE(created_at) = CURRENT_DATE) THEN
       PERFORM notify_by_role(rec.factory_id, 'production_manager', 'overdue_prod', 'Просрочка этапа', 'Этап ' || rec.stage_type || ' просрочен для ' || rec.machine_name || ' на ' || (CURRENT_DATE - rec.planned_date_end) || ' дней', rec.machine_id);
       PERFORM notify_all_directors(rec.factory_id, 'overdue_prod', 'Просрочка этапа', 'Этап ' || rec.stage_type || ' просрочен для ' || rec.machine_name || ' на ' || (CURRENT_DATE - rec.planned_date_end) || ' дней', rec.machine_id);
    END IF;
  END LOOP;

  -- C) ПРОСРОЧКИ ИНВОЙСОВ (12)
  FOR rec IN
    SELECT i.*, m.name as machine_name, m.created_by, m.factory_id 
    FROM invoices i
    JOIN machines m ON i.machine_id = m.id
    WHERE i.status = 'not_paid' AND i.payment_date IS NOT NULL
      AND CURRENT_DATE > i.payment_date
  LOOP
    IF NOT EXISTS (SELECT 1 FROM notifications WHERE type='overdue_inv' AND related_machine_id=rec.machine_id AND DATE(created_at) = CURRENT_DATE) THEN
       -- Вызов sales creator
       PERFORM notify_user(rec.created_by, 'overdue_inv', 'Инвойс просрочен', 'Инвойс по машине ' || rec.machine_name || ' просрочен на ' || (CURRENT_DATE - rec.payment_date) || ' дней. Сумма: ' || rec.amount, rec.machine_id);
       -- Финансовому подразделению
       PERFORM notify_by_role(rec.factory_id, 'financial_director', 'overdue_inv', 'Инвойс просрочен', 'Инвойс по машине ' || rec.machine_name || ' просрочен на ' || (CURRENT_DATE - rec.payment_date) || ' дней. Сумма: ' || rec.amount, rec.machine_id);
    END IF;
  END LOOP;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
