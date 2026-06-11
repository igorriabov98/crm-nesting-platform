-- 01_factories.sql
-- Ð¡Ð¾Ð·Ð´Ð°Ð½Ð¸Ðµ Ñ‚Ð°Ð±Ð»Ð¸Ñ†Ñ‹ Ð·Ð°Ð²Ð¾Ð´Ð¾Ð²

CREATE TABLE factories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL, -- "Ð‘ÐµÑ€Ð³Ð¾Ð²Ð¾" Ð¸Ð»Ð¸ "Ð£Ð¶Ð³Ð¾Ñ€Ð¾Ð´"
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ÐšÐ¾Ð¼Ð¼ÐµÐ½Ñ‚Ð°Ñ€Ð¸Ð¸
COMMENT ON TABLE factories IS 'Ð—Ð°Ð²Ð¾Ð´Ñ‹: Ð‘ÐµÑ€Ð³Ð¾Ð²Ð¾ Ð¸Ð»Ð¸ Ð£Ð¶Ð³Ð¾Ñ€Ð¾Ð´';

