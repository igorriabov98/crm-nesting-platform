-- 06_invoices.sql
-- Статус инвойса
CREATE TYPE invoice_status AS ENUM (
    'paid',
    'not_paid',
    'overdue'
);

-- Таблица инвойсов
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id UUID UNIQUE NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    amount DECIMAL NOT NULL,
    payment_date DATE,
    status invoice_status DEFAULT 'not_paid',
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Индексы
CREATE INDEX idx_invoices_machine_id ON invoices(machine_id);
CREATE INDEX idx_invoices_status ON invoices(status);

-- Триггеры для автоматических расчетов

-- 1. Триггер для обновления payment_date на основе production_stages (этап shipping)
-- payment_date = shipping.date_end + 14 дней
CREATE OR REPLACE FUNCTION update_invoice_payment_date()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.stage_type = 'shipping' THEN
        IF NEW.date_end IS NOT NULL THEN
            UPDATE invoices
            SET payment_date = NEW.date_end + 14
            WHERE machine_id = NEW.machine_id;
        ELSE
            UPDATE invoices
            SET payment_date = NULL
            WHERE machine_id = NEW.machine_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_payment_date_from_shipping
AFTER INSERT OR UPDATE OF date_end ON production_stages
FOR EACH ROW
WHEN (NEW.stage_type = 'shipping')
EXECUTE FUNCTION update_invoice_payment_date();

-- 2. Триггер обновляющий статус инвойса на overdue при изменении (если сегодня > payment_date)
-- (Примечание: для автоматического ежедневного обновления статусов нужен cron job / pg_cron,
-- этот триггер покрывает только события INSERT / UPDATE)
CREATE OR REPLACE FUNCTION check_invoice_overdue()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'not_paid' AND NEW.payment_date IS NOT NULL AND NEW.payment_date < CURRENT_DATE THEN
        NEW.status := 'overdue';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_invoice_overdue
BEFORE INSERT OR UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION check_invoice_overdue();

-- Комментарии
COMMENT ON TABLE invoices IS 'Инвойсы (Счета) по машинам';
