-- 03_machines.sql
-- Создание типа покрытия
CREATE TYPE coating_type AS ENUM (
    'zinc',
    'powder_coating',
    'none'
);

-- Создание таблицы машин (Sales Plan)
CREATE TABLE machines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    tonnage DECIMAL NOT NULL,
    drawings TEXT,
    product TEXT,
    coating coating_type NOT NULL,
    ral_number TEXT,
    invoice_amount DECIMAL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Индексы
CREATE INDEX idx_machines_factory_id ON machines(factory_id);
CREATE INDEX idx_machines_created_by ON machines(created_by);

-- Комментарии
COMMENT ON TABLE machines IS 'План продаж (машины)';
