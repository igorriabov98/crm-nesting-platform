DO $$
BEGIN
  CREATE TYPE order_item_status AS ENUM ('pending', 'ordered', 'delivered');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE request_sheet_metal
  ADD COLUMN IF NOT EXISTS order_status order_item_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

ALTER TABLE request_round_tube
  ADD COLUMN IF NOT EXISTS order_status order_item_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

ALTER TABLE request_knives
  ADD COLUMN IF NOT EXISTS order_status order_item_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

ALTER TABLE request_components
  ADD COLUMN IF NOT EXISTS order_status order_item_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

ALTER TABLE request_paint
  ADD COLUMN IF NOT EXISTS order_status order_item_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
