ALTER TABLE public.nesting_batches
  DROP CONSTRAINT IF EXISTS nesting_batches_status_check;

ALTER TABLE public.nesting_batches
  ADD CONSTRAINT nesting_batches_status_check
  CHECK (status IN ('draft', 'parsing', 'parsed', 'calculating', 'done', 'completed_with_warnings', 'error'));
