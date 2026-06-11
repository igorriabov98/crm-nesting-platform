-- Статус жизненного цикла машины
CREATE TYPE machine_status AS ENUM (
  'created',           -- Создана (Sales создал, завод не назначен)
  'under_review',      -- На рассмотрении (включена в повестку собрания)
  'factory_assigned',  -- Назначен завод
  'in_production',     -- В производстве (хотя бы 1 этап начат)
  'shipped'            -- Отгружена
);

-- Тип материала (на уровне машины)
CREATE TYPE material_type AS ENUM (
  'standard',          -- Стандартный
  'non_standard',      -- Нестандартный
  'undefined'          -- Не определён
);

-- Сначала дропаем view, так как оно использует m.* и зависимо от структуры таблицы
DROP VIEW IF EXISTS machines_with_totals CASCADE;

-- Добавить поля в machines
ALTER TABLE machines
  ADD COLUMN status machine_status NOT NULL DEFAULT 'created',
  ADD COLUMN material_type material_type NOT NULL DEFAULT 'undefined';

-- Сделать factory_id NULLABLE (машина создаётся без завода)
ALTER TABLE machines
  ALTER COLUMN factory_id DROP NOT NULL;

-- Восстанавливаем View, чтобы новые колонки (status, material_type) появились
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

-- Автоматически менять статус на 'in_production'
-- когда хотя бы один этап получает date_start
CREATE OR REPLACE FUNCTION fn_update_machine_status_on_production()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.date_start IS NOT NULL AND OLD.date_start IS NULL THEN
    UPDATE machines
    SET status = 'in_production'
    WHERE id = NEW.machine_id
      AND status IN ('created', 'under_review', 'factory_assigned');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_update_machine_status_production
  AFTER UPDATE ON production_stages
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_machine_status_on_production();

-- Автоматически менять статус на 'shipped'
-- когда shipping.date_end заполнен
CREATE OR REPLACE FUNCTION fn_update_machine_status_on_shipping()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stage_type = 'shipping'
     AND NEW.date_end IS NOT NULL
     AND (OLD.date_end IS NULL OR OLD.date_end != NEW.date_end) THEN
    UPDATE machines
    SET status = 'shipped'
    WHERE id = NEW.machine_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_update_machine_status_shipping
  AFTER UPDATE ON production_stages
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_machine_status_on_shipping();
