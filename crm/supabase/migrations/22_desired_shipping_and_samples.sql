-- Desired customer shipping date on machines.
ALTER TABLE machines
  ADD COLUMN IF NOT EXISTS desired_shipping_date date;

-- Samples are stored as machine_items and included in totals.
ALTER TABLE machine_items
  ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;

DROP VIEW IF EXISTS machines_with_totals CASCADE;

CREATE VIEW machines_with_totals AS
SELECT
    m.*,
    COALESCE(
        (SELECT SUM(mi.weight * mi.quantity) / 1000
         FROM machine_items mi
         WHERE mi.machine_id = m.id),
        0
    ) AS total_weight,
    COALESCE(
        (SELECT SUM(mi.price * mi.quantity)
         FROM machine_items mi
         WHERE mi.machine_id = m.id),
        0
    ) AS total_items_cost,
    COALESCE(
        (SELECT SUM(me.amount)
         FROM machine_expenses me
         WHERE me.machine_id = m.id),
        0
    ) AS total_expenses,
    COALESCE(
        (SELECT SUM(mi.price * mi.quantity)
         FROM machine_items mi
         WHERE mi.machine_id = m.id),
        0
    ) + COALESCE(
        (SELECT SUM(me.amount)
         FROM machine_expenses me
         WHERE me.machine_id = m.id),
        0
    ) AS total_cost,
    COALESCE(
        (SELECT COUNT(mi.id)
         FROM machine_items mi
         WHERE mi.machine_id = m.id),
        0
    ) AS item_count,
    EXISTS (
        SELECT 1 FROM machine_items mi
        WHERE mi.machine_id = m.id AND mi.coating = 'zinc'
    ) AS has_zinc,
    EXISTS (
        SELECT 1 FROM machine_items mi
        WHERE mi.machine_id = m.id AND mi.coating = 'powder_coating'
    ) AS has_painting
FROM machines m;

CREATE OR REPLACE FUNCTION fn_generate_meeting_agenda(p_meeting_id uuid)
RETURNS void AS $$
DECLARE
  v_mtype text;
  v_mach RECORD;
  v_fname text;
  v_fid uuid;
BEGIN
  v_mtype := (SELECT meeting_type::text FROM meetings WHERE id = p_meeting_id);

  IF v_mtype = 'general' THEN
    FOR v_mach IN
      SELECT id, name, desired_shipping_date FROM machines
      WHERE factory_id IS NULL
        AND status IN ('created', 'under_review')
      ORDER BY created_at
    LOOP
      INSERT INTO meeting_agenda_items
        (meeting_id, machine_id, title, description, auto_generated, sort_order)
      VALUES (
        p_meeting_id,
        v_mach.id,
        'ÐÐ°Ð·Ð½Ð°Ñ‡Ð¸Ñ‚ÑŒ Ð·Ð°Ð²Ð¾Ð´: ' || v_mach.name,
        CASE
          WHEN v_mach.desired_shipping_date IS NOT NULL THEN
            'ÐœÐ°ÑˆÐ¸Ð½Ð° Ð±ÐµÐ· Ð½Ð°Ð·Ð½Ð°Ñ‡ÐµÐ½Ð½Ð¾Ð³Ð¾ Ð·Ð°Ð²Ð¾Ð´Ð°. ÐÐµÐ¾Ð±Ñ…Ð¾Ð´Ð¸Ð¼Ð¾ Ð¾Ð¿Ñ€ÐµÐ´ÐµÐ»Ð¸Ñ‚ÑŒ: Ð‘ÐµÑ€Ð³Ð¾Ð²Ð¾ Ð¸Ð»Ð¸ Ð£Ð¶Ð³Ð¾Ñ€Ð¾Ð´. Ð–ÐµÐ»Ð°ÐµÐ¼Ð°Ñ Ð¾Ñ‚Ð³Ñ€ÑƒÐ·ÐºÐ°: ' || to_char(v_mach.desired_shipping_date, 'DD.MM.YYYY') || '.'
          ELSE
            'ÐœÐ°ÑˆÐ¸Ð½Ð° Ð±ÐµÐ· Ð½Ð°Ð·Ð½Ð°Ñ‡ÐµÐ½Ð½Ð¾Ð³Ð¾ Ð·Ð°Ð²Ð¾Ð´Ð°. ÐÐµÐ¾Ð±Ñ…Ð¾Ð´Ð¸Ð¼Ð¾ Ð¾Ð¿Ñ€ÐµÐ´ÐµÐ»Ð¸Ñ‚ÑŒ: Ð‘ÐµÑ€Ð³Ð¾Ð²Ð¾ Ð¸Ð»Ð¸ Ð£Ð¶Ð³Ð¾Ñ€Ð¾Ð´.'
        END,
        true,
        1
      );
    END LOOP;

    FOR v_mach IN
      SELECT id, name FROM machines
      WHERE material_type = 'undefined'
        AND status NOT IN ('shipped')
      ORDER BY created_at
    LOOP
      INSERT INTO meeting_agenda_items
        (meeting_id, machine_id, title, description, auto_generated, sort_order)
      VALUES (
        p_meeting_id,
        v_mach.id,
        'ÐžÐ¿Ñ€ÐµÐ´ÐµÐ»Ð¸Ñ‚ÑŒ Ñ‚Ð¸Ð¿ Ð¼Ð°Ñ‚ÐµÑ€Ð¸Ð°Ð»Ð°: ' || v_mach.name,
        'Ð¢Ð¸Ð¿ Ð¼Ð°Ñ‚ÐµÑ€Ð¸Ð°Ð»Ð° Ð½Ðµ Ð¾Ð¿Ñ€ÐµÐ´ÐµÐ»Ñ‘Ð½.',
        true,
        2
      );
    END LOOP;
  END IF;

  IF v_mtype IN ('factory_bergovo', 'factory_uzhgorod') THEN
    IF v_mtype = 'factory_bergovo' THEN
      v_fname := 'Ð‘ÐµÑ€Ð³Ð¾Ð²Ð¾';
    ELSE
      v_fname := 'Ð£Ð¶Ð³Ð¾Ñ€Ð¾Ð´';
    END IF;

    v_fid := (SELECT id FROM factories WHERE name = v_fname LIMIT 1);

    FOR v_mach IN
      SELECT DISTINCT m.id, m.name
      FROM machines m
      JOIN production_stages ps ON ps.machine_id = m.id
      WHERE m.factory_id = v_fid
        AND ps.date_end IS NULL
        AND ps.is_skipped = false
        AND ps.planned_date_end < CURRENT_DATE
    LOOP
      INSERT INTO meeting_agenda_items
        (meeting_id, machine_id, title, description, auto_generated, sort_order)
      VALUES (
        p_meeting_id,
        v_mach.id,
        'ÐŸÑ€Ð¾ÑÑ€Ð¾Ñ‡ÐºÐ°: ' || v_mach.name,
        'Ð•ÑÑ‚ÑŒ Ð¿Ñ€Ð¾ÑÑ€Ð¾Ñ‡ÐµÐ½Ð½Ñ‹Ðµ ÑÑ‚Ð°Ð¿Ñ‹ Ð¿Ñ€Ð¾Ð¸Ð·Ð²Ð¾Ð´ÑÑ‚Ð²Ð°.',
        true,
        3
      );
    END LOOP;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

