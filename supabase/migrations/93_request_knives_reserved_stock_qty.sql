ALTER TABLE request_knives
  ADD COLUMN IF NOT EXISTS reserved_from_stock_qty numeric NOT NULL DEFAULT 0;
