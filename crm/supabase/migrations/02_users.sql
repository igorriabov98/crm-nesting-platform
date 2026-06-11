-- 02_users.sql
-- Создание типа роли
CREATE TYPE user_role AS ENUM (
    'financial_director',
    'commercial_director',
    'planning_director',
    'sales_manager',
    'engineer',
    'technologist',
    'supply_manager',
    'production_manager'
);

-- Создание таблицы пользователей
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- связь с auth.users
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role user_role NOT NULL,
    factory_id UUID REFERENCES factories(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Индексы
CREATE INDEX idx_users_factory_id ON users(factory_id);
CREATE INDEX idx_users_email ON users(email);

-- Комментарии
COMMENT ON TABLE users IS 'Пользователи системы и их роли';
