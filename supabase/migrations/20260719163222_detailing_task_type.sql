-- The enum value must be committed before the main detailing migration can
-- use it in indexes, policies and functions.
ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'detailing_transfer';
