-- 04_production_stages.sql
-- Создание типа этапа
CREATE TYPE stage_type AS ENUM (
    'cutting',
    'assembly',
    'cleaning',
    'galvanizing',
    'painting',
    'packaging',
    'shipping'
);

-- Создание таблицы этапов производства
CREATE TABLE production_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    stage_type stage_type NOT NULL,
    workshop SMALLINT, -- 1 или 2
    date_start DATE,
    date_end DATE,
    is_skipped BOOLEAN DEFAULT false,
    is_night_shift BOOLEAN DEFAULT false,
    night_shift_date DATE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Индексы
CREATE INDEX idx_production_stages_machine_id ON production_stages(machine_id);

-- Комментарии
COMMENT ON TABLE production_stages IS 'Этапы производства для машин';
