ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS delivery_basis_en text NOT NULL DEFAULT 'Delivery Basis: DAP',
  ADD COLUMN IF NOT EXISTS delivery_basis_ua text NOT NULL DEFAULT 'Базис постачання: DAP';

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS delivery_basis_location_en text,
  ADD COLUMN IF NOT EXISTS delivery_basis_location_ua text;
