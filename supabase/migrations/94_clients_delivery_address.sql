ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS delivery_address text;
