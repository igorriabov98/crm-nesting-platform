-- Keep supplier service flags available even if an older production database
-- missed the outsourcing transport migration.
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS can_outsource boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_transport boolean NOT NULL DEFAULT false;
