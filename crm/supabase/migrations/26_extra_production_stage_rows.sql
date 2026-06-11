CREATE OR REPLACE FUNCTION trg_create_production_stages()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO production_stages (machine_id, stage_type, workshop, is_skipped)
    VALUES (NEW.id, 'cutting', 1, false);

    INSERT INTO production_stages (machine_id, stage_type, is_skipped)
    VALUES (NEW.id, 'assembly', false);

    INSERT INTO production_stages (machine_id, stage_type, is_skipped)
    VALUES (NEW.id, 'cleaning', false);

    INSERT INTO production_stages (machine_id, stage_type, is_skipped)
    VALUES (NEW.id, 'galvanizing', false);

    INSERT INTO production_stages (machine_id, stage_type, is_skipped)
    VALUES (NEW.id, 'post_galvanizing_cleaning', false);

    INSERT INTO production_stages (machine_id, stage_type, workshop, is_skipped)
    VALUES (NEW.id, 'painting', 2, false);

    INSERT INTO production_stages (machine_id, stage_type, workshop, is_skipped)
    VALUES (NEW.id, 'packaging', 2, false);

    INSERT INTO production_stages (machine_id, stage_type, is_skipped)
    VALUES (NEW.id, 'shipping', false);

    INSERT INTO production_stages (machine_id, stage_type, is_skipped)
    VALUES (NEW.id, 'actual_shipping', false);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

INSERT INTO production_stages (machine_id, stage_type, is_skipped)
SELECT m.id, 'post_galvanizing_cleaning', false
FROM machines m
WHERE NOT EXISTS (
  SELECT 1
  FROM production_stages ps
  WHERE ps.machine_id = m.id
    AND ps.stage_type = 'post_galvanizing_cleaning'
);

INSERT INTO production_stages (machine_id, stage_type, is_skipped)
SELECT m.id, 'actual_shipping', false
FROM machines m
WHERE NOT EXISTS (
  SELECT 1
  FROM production_stages ps
  WHERE ps.machine_id = m.id
    AND ps.stage_type = 'actual_shipping'
);
