\set ON_ERROR_STOP on

-- The transfer lifecycle fixture creates an ephemeral third factory with id/name only.
-- Production transport migrations require city, so provide a local test-only default.
ALTER TABLE public.factories
  ALTER COLUMN city SET DEFAULT 'Тестовый город';
