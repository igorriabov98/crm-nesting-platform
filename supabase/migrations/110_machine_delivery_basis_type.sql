ALTER TABLE public.machines
  ADD COLUMN IF NOT EXISTS delivery_basis_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'machines_delivery_basis_type_check'
      AND conrelid = 'public.machines'::regclass
  ) THEN
    ALTER TABLE public.machines
      ADD CONSTRAINT machines_delivery_basis_type_check
      CHECK (
        delivery_basis_type IS NULL
        OR delivery_basis_type IN ('own_delivery', 'partner_truck')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.machines.delivery_basis_type IS 'Machine-level delivery basis used in generated documents.';
