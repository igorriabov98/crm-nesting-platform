ALTER TABLE public.machines
  ADD COLUMN IF NOT EXISTS packing_boxes_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.machines
  DROP CONSTRAINT IF EXISTS machines_packing_boxes_count_check;

ALTER TABLE public.machines
  ADD CONSTRAINT machines_packing_boxes_count_check
  CHECK (packing_boxes_count >= 0 AND packing_boxes_count <= 999);

COMMENT ON COLUMN public.machines.packing_boxes_count IS 'Box count printed in packing list summary text. Not included in total places.';
