    -- Подготовим текст
CREATE EXTENSION IF NOT EXISTS pg_cron;

----------------------------------------------------------
    -- Подготовим текст
----------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_notify_on_meeting_attendee()
RETURNS TRIGGER AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_date_str text;
BEGIN
  SELECT * INTO v_meeting FROM meetings WHERE id = NEW.meeting_id;
  v_date_str := to_char(v_meeting.meeting_date, 'DD.MM.YYYY');

  INSERT INTO notifications (user_id, type, title, message)
  VALUES (
    NEW.user_id,
    'meeting_invite',
    'ÐÐ¾Ð²Ð¾Ðµ ÑÐ¾Ð±Ñ€Ð°Ð½Ð¸Ðµ',
    'Ð’Ñ‹ Ð´Ð¾Ð±Ð°Ð²Ð»ÐµÐ½Ñ‹ Ð² ÑÐ¾Ð±Ñ€Ð°Ð½Ð¸Ðµ ' || v_date_str || ' Ð² ' || to_char(v_meeting.meeting_time, 'HH24:MI') || '.'
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notify_meeting_attendee
  AFTER INSERT ON meeting_attendees
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_on_meeting_attendee();

----------------------------------------------------------
    -- Подготовим текст
----------------------------------------------------------
    -- Подготовим текст
    -- Подготовим текст
CREATE OR REPLACE FUNCTION fn_notify_on_factory_assigned()
RETURNS TRIGGER AS $$
DECLARE
  v_prod_manager_id uuid;
BEGIN
    -- Подготовим текст
  IF NEW.factory_id IS NOT NULL AND (OLD.factory_id IS NULL OR OLD.factory_id != NEW.factory_id) THEN
    -- Подготовим текст
    FOR v_prod_manager_id IN
      SELECT id FROM users
      WHERE factory_id = NEW.factory_id AND role = 'production_manager' AND is_active = true
    LOOP
      INSERT INTO notifications (user_id, type, title, message, related_machine_id)
      VALUES (
        v_prod_manager_id,
        'machine_assigned',
        'ÐœÐ°ÑˆÐ¸Ð½Ð° Ð½Ð°Ð·Ð½Ð°Ñ‡ÐµÐ½Ð° Ð²Ð°ÑˆÐµÐ¼Ñƒ Ð·Ð°Ð²Ð¾Ð´Ñƒ',
        'ÐœÐ°ÑˆÐ¸Ð½Ð° Â«' || NEW.name || 'Â» Ð±Ñ‹Ð»Ð° Ð½Ð°Ð·Ð½Ð°Ñ‡ÐµÐ½Ð° Ð´Ð»Ñ Ð¿Ñ€Ð¾Ð¸Ð·Ð²Ð¾Ð´ÑÑ‚Ð²Ð° Ð½Ð° Ð²Ð°ÑˆÐµÐ¼ Ð·Ð°Ð²Ð¾Ð´Ðµ.',
        NEW.id
      );
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notify_factory_assigned
  AFTER UPDATE OF factory_id ON machines
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_on_factory_assigned();

----------------------------------------------------------
    -- Подготовим текст
----------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_daily_meeting_reminders()
RETURNS void AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_attendee RECORD;
  v_count int;
  v_title text;
BEGIN
    -- Подготовим текст
  FOR v_meeting IN
    SELECT * FROM meetings
    WHERE meeting_date = CURRENT_DATE AND status = 'planned'
  LOOP
    -- Подготовим текст
    IF v_meeting.meeting_type = 'general' THEN
      v_title := 'Общее собрание';
    ELSIF v_meeting.meeting_type = 'factory_bergovo' THEN
      v_title := 'Собрание Берегово';
    ELSE
      v_title := 'Собрание Ужгород';
    END IF;

    -- Подготовим текст
    SELECT count(*) INTO v_count FROM meeting_agenda_items WHERE meeting_id = v_meeting.id;

    -- Подготовим текст
    FOR v_attendee IN
      SELECT user_id FROM meeting_attendees WHERE meeting_id = v_meeting.id
    LOOP
      INSERT INTO notifications (user_id, type, title, message)
      VALUES (
        v_attendee.user_id,
        'meeting_reminder',
        'ÐÐ°Ð¿Ð¾Ð¼Ð¸Ð½Ð°Ð½Ð¸Ðµ Ð¾ ÑÐ¾Ð±Ñ€Ð°Ð½Ð¸Ð¸',
        'Ð¡ÐµÐ³Ð¾Ð´Ð½Ñ ' || v_title || ' Ð² ' || to_char(v_meeting.meeting_time, 'HH24:MI') || '. ÐŸÐ¾Ð²ÐµÑÑ‚ÐºÐ°: ' || v_count || ' Ð¿ÑƒÐ½ÐºÑ‚Ð¾Ð² Ðº Ð¾Ð±ÑÑƒÐ¶Ð´ÐµÐ½Ð¸ÑŽ.'
      );
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

----------------------------------------------------------
    -- Подготовим текст
----------------------------------------------------------
    -- Подготовим текст
    -- Подготовим текст
SELECT cron.schedule(
  'daily-meeting-reminders',
  '0 8 * * *',
  $$ SELECT public.fn_daily_meeting_reminders(); $$
);

