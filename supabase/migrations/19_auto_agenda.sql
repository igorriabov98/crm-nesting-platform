-- Ð¤ÑƒÐ½ÐºÑ†Ð¸Ñ Ð°Ð²Ñ‚Ð¾Ð¼Ð°Ñ‚Ð¸Ñ‡ÐµÑÐºÐ¾Ð³Ð¾ Ñ„Ð¾Ñ€Ð¼Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ñ Ð¿Ð¾Ð²ÐµÑÑ‚ÐºÐ¸ ÑÐ¾Ð±Ñ€Ð°Ð½Ð¸Ñ
-- Ð’Ñ‹Ð·Ñ‹Ð²Ð°ÐµÑ‚ÑÑ Ð¿Ñ€Ð¸ ÑÐ¾Ð·Ð´Ð°Ð½Ð¸Ð¸ ÑÐ¾Ð±Ñ€Ð°Ð½Ð¸Ñ Ð¸Ð»Ð¸ Ð²Ñ€ÑƒÑ‡Ð½ÑƒÑŽ

CREATE OR REPLACE FUNCTION fn_generate_meeting_agenda(p_meeting_id uuid)
RETURNS void AS $$
DECLARE
  v_mtype text;
  v_mach RECORD;
  v_fname text;
  v_fid uuid;
BEGIN
  v_mtype := (SELECT meeting_type::text FROM meetings WHERE id = p_meeting_id);

  -- Ð”Ð»Ñ ÐžÐ‘Ð©Ð•Ð“Ðž ÑÐ¾Ð±Ñ€Ð°Ð½Ð¸Ñ: Ð¼Ð°ÑˆÐ¸Ð½Ñ‹ Ð±ÐµÐ· Ð·Ð°Ð²Ð¾Ð´Ð°
  IF v_mtype = 'general' THEN

    -- ÐœÐ°ÑˆÐ¸Ð½Ñ‹ Ð±ÐµÐ· Ð½Ð°Ð·Ð½Ð°Ñ‡ÐµÐ½Ð½Ð¾Ð³Ð¾ Ð·Ð°Ð²Ð¾Ð´Ð°
    FOR v_mach IN
      SELECT id, name FROM machines
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
        'ÐœÐ°ÑˆÐ¸Ð½Ð° Ð±ÐµÐ· Ð½Ð°Ð·Ð½Ð°Ñ‡ÐµÐ½Ð½Ð¾Ð³Ð¾ Ð·Ð°Ð²Ð¾Ð´Ð°. ÐÐµÐ¾Ð±Ñ…Ð¾Ð´Ð¸Ð¼Ð¾ Ð¾Ð¿Ñ€ÐµÐ´ÐµÐ»Ð¸Ñ‚ÑŒ: Ð‘ÐµÑ€Ð³Ð¾Ð²Ð¾ Ð¸Ð»Ð¸ Ð£Ð¶Ð³Ð¾Ñ€Ð¾Ð´.',
        true,
        1
      );
    END LOOP;

    -- ÐœÐ°ÑˆÐ¸Ð½Ñ‹ Ð±ÐµÐ· Ñ‚Ð¸Ð¿Ð° Ð¼Ð°Ñ‚ÐµÑ€Ð¸Ð°Ð»Ð°
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

  -- Ð”Ð»Ñ Ð—ÐÐ’ÐžÐ”Ð¡ÐšÐžÐ“Ðž ÑÐ¾Ð±Ñ€Ð°Ð½Ð¸Ñ: Ð¿Ñ€Ð¾ÑÑ€Ð¾Ñ‡ÐºÐ¸ ÑÑ‚Ð¾Ð³Ð¾ Ð·Ð°Ð²Ð¾Ð´Ð°
  IF v_mtype IN ('factory_bergovo', 'factory_uzhgorod') THEN
    IF v_mtype = 'factory_bergovo' THEN
      v_fname := 'Ð‘ÐµÑ€Ð³Ð¾Ð²Ð¾';
    ELSE
      v_fname := 'Ð£Ð¶Ð³Ð¾Ñ€Ð¾Ð´';
    END IF;

    v_fid := (SELECT id FROM factories WHERE name = v_fname LIMIT 1);

    -- ÐœÐ°ÑˆÐ¸Ð½Ñ‹ Ñ Ð¿Ñ€Ð¾ÑÑ€Ð¾Ñ‡ÐµÐ½Ð½Ñ‹Ð¼Ð¸ ÑÑ‚Ð°Ð¿Ð°Ð¼Ð¸
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

