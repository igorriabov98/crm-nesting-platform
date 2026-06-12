-- 05_supply_items.sql
-- Статус заказа
CREATE TYPE supply_status AS ENUM (
    'received',
    'ordered',
    'not_ordered'
);

-- Таблица компонентов снабжения
CREATE TABLE supply_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    engineer_confirmation BOOLEAN DEFAULT false,
    engineer_confirmed_at TIMESTAMPTZ,
    engineer_deadline DATE,
    nomenclature TEXT,
    unit TEXT,
    quantity DECIMAL,
    technologist_deadline DATE,
    supplier TEXT,
    price_per_unit DECIMAL,
    status supply_status DEFAULT 'not_ordered',
    comment TEXT,
    planned_delivery_date DATE,
    deadline DATE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Индексы
CREATE INDEX idx_supply_items_machine_id ON supply_items(machine_id);
CREATE INDEX idx_supply_items_status ON supply_items(status);

-- Триггеры для автоматических расчетов
-- technologist_deadline = planned_delivery_date - 10 дней
-- engineer_deadline = technologist_deadline - 2 дня
CREATE OR REPLACE FUNCTION update_supply_deadlines()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.planned_delivery_date IS NOT NULL THEN
        -- Вычисляем дни как простое вычитание integer из DATE
        NEW.technologist_deadline := NEW.planned_delivery_date - 10;
        NEW.engineer_deadline := NEW.technologist_deadline - 2;
    ELSE
        NEW.technologist_deadline := NULL;
        NEW.engineer_deadline := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calc_supply_deadlines
BEFORE INSERT OR UPDATE OF planned_delivery_date ON supply_items
FOR EACH ROW
EXECUTE FUNCTION update_supply_deadlines();

-- Комментарии
COMMENT ON TABLE supply_items IS 'Компоненты снабжения по машинам';
