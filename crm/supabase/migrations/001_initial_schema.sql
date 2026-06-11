-- 001_initial_schema.sql
-- Standalone production-stage tracking schema for Telegram bot, CRM sync, and Gantt views.
-- The objects are isolated in prod_tracking to avoid conflicts with the existing CRM public schema.

CREATE SCHEMA IF NOT EXISTS prod_tracking;

-- =============================================================================
-- Tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS prod_tracking.workshops (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prod_tracking.users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT NOT NULL UNIQUE,
    telegram_username VARCHAR(100) NULL,
    full_name VARCHAR(200) NOT NULL,
    role VARCHAR(20) NOT NULL,
    workshop_id INTEGER NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    notification_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_users_role CHECK (role IN ('director', 'workshop_head', 'manager')),
    CONSTRAINT fk_users_workshop FOREIGN KEY (workshop_id) REFERENCES prod_tracking.workshops(id)
);

CREATE TABLE IF NOT EXISTS prod_tracking.orders (
    id SERIAL PRIMARY KEY,
    order_number VARCHAR(50) NOT NULL UNIQUE,
    title VARCHAR(300) NOT NULL,
    workshop_id INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'planned',
    priority VARCHAR(10) NOT NULL DEFAULT 'normal',
    client_name VARCHAR(200) NULL,
    notes TEXT NULL,
    crm_order_id VARCHAR(100) NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_orders_status CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
    CONSTRAINT chk_orders_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    CONSTRAINT fk_orders_workshop FOREIGN KEY (workshop_id) REFERENCES prod_tracking.workshops(id)
);

CREATE TABLE IF NOT EXISTS prod_tracking.stages (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL,
    name VARCHAR(200) NOT NULL,
    sequence_number INTEGER NOT NULL,
    planned_start_date DATE NOT NULL,
    planned_end_date DATE NOT NULL,
    actual_start_date DATE NULL,
    actual_end_date DATE NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'not_started',
    notes TEXT NULL,
    crm_stage_id VARCHAR(100) NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_stages_status CHECK (status IN ('not_started', 'in_progress', 'completed', 'skipped')),
    CONSTRAINT chk_stages_planned_dates CHECK (planned_end_date >= planned_start_date),
    CONSTRAINT chk_stages_actual_end_requires_start CHECK (actual_end_date IS NULL OR actual_start_date IS NOT NULL),
    CONSTRAINT chk_stages_actual_dates CHECK (actual_end_date IS NULL OR actual_end_date >= actual_start_date),
    CONSTRAINT uq_stages_order_sequence UNIQUE (order_id, sequence_number),
    CONSTRAINT fk_stages_order FOREIGN KEY (order_id) REFERENCES prod_tracking.orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS prod_tracking.stage_logs (
    id SERIAL PRIMARY KEY,
    stage_id INTEGER NOT NULL,
    user_id INTEGER NULL,
    action VARCHAR(30) NOT NULL,
    old_value TEXT NULL,
    new_value TEXT NULL,
    source VARCHAR(20) NOT NULL DEFAULT 'system',
    metadata JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_stage_logs_action CHECK (
        action IN (
            'fact_start_recorded',
            'fact_end_recorded',
            'date_changed',
            'escalation_warning',
            'escalation_sent',
            'reminder_sent',
            'voice_recorded',
            'problem_reported',
            'plan_synced'
        )
    ),
    CONSTRAINT chk_stage_logs_source CHECK (source IN ('button', 'voice', 'manual', 'auto', 'crm_sync', 'system')),
    CONSTRAINT fk_stage_logs_stage FOREIGN KEY (stage_id) REFERENCES prod_tracking.stages(id) ON DELETE CASCADE,
    CONSTRAINT fk_stage_logs_user FOREIGN KEY (user_id) REFERENCES prod_tracking.users(id)
);

CREATE TABLE IF NOT EXISTS prod_tracking.notification_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    setting_key VARCHAR(50) NOT NULL,
    setting_value VARCHAR(200) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_notification_settings_user_key UNIQUE (user_id, setting_key),
    CONSTRAINT fk_notification_settings_user FOREIGN KEY (user_id) REFERENCES prod_tracking.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS prod_tracking.escalation_rules (
    id SERIAL PRIMARY KEY,
    workshop_id INTEGER NULL,
    days_overdue_warning INTEGER NOT NULL DEFAULT 2,
    days_overdue_escalation INTEGER NOT NULL DEFAULT 3,
    escalation_target_user_id INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_escalation_rules_days CHECK (days_overdue_escalation > days_overdue_warning),
    CONSTRAINT fk_escalation_rules_workshop FOREIGN KEY (workshop_id) REFERENCES prod_tracking.workshops(id),
    CONSTRAINT fk_escalation_rules_target_user FOREIGN KEY (escalation_target_user_id) REFERENCES prod_tracking.users(id)
);

CREATE TABLE IF NOT EXISTS prod_tracking.sync_queue (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL,
    entity_id INTEGER NOT NULL,
    action VARCHAR(20) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 10,
    last_error TEXT NULL,
    next_retry_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ NULL,
    CONSTRAINT chk_sync_queue_entity_type CHECK (entity_type IN ('stage', 'order')),
    CONSTRAINT chk_sync_queue_action CHECK (action IN ('update_fact', 'update_status', 'create', 'delete')),
    CONSTRAINT chk_sync_queue_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS prod_tracking.error_logs (
    id SERIAL PRIMARY KEY,
    error_level VARCHAR(10) NOT NULL DEFAULT 'error',
    module VARCHAR(100) NOT NULL,
    error_type VARCHAR(200) NOT NULL,
    error_message TEXT NOT NULL,
    stack_trace TEXT NULL,
    user_id INTEGER NULL,
    context JSONB NULL,
    is_resolved BOOLEAN NOT NULL DEFAULT false,
    resolved_at TIMESTAMPTZ NULL,
    resolved_by VARCHAR(100) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_error_logs_level CHECK (error_level IN ('debug', 'info', 'warning', 'error', 'critical')),
    CONSTRAINT fk_error_logs_user FOREIGN KEY (user_id) REFERENCES prod_tracking.users(id)
);

CREATE TABLE IF NOT EXISTS prod_tracking.bot_message_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NULL,
    direction VARCHAR(10) NOT NULL,
    message_type VARCHAR(30) NOT NULL,
    content_preview VARCHAR(500) NULL,
    telegram_message_id BIGINT NULL,
    handler_name VARCHAR(100) NULL,
    processing_time_ms INTEGER NULL,
    is_success BOOLEAN NOT NULL DEFAULT true,
    error_log_id INTEGER NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_bot_message_log_direction CHECK (direction IN ('incoming', 'outgoing')),
    CONSTRAINT fk_bot_message_log_user FOREIGN KEY (user_id) REFERENCES prod_tracking.users(id),
    CONSTRAINT fk_bot_message_log_error FOREIGN KEY (error_log_id) REFERENCES prod_tracking.error_logs(id)
);

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_orders_workshop_id ON prod_tracking.orders(workshop_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON prod_tracking.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_workshop_status ON prod_tracking.orders(workshop_id, status);

CREATE INDEX IF NOT EXISTS idx_stages_order_id ON prod_tracking.stages(order_id);
CREATE INDEX IF NOT EXISTS idx_stages_planned_start ON prod_tracking.stages(planned_start_date);
CREATE INDEX IF NOT EXISTS idx_stages_status ON prod_tracking.stages(status);
CREATE INDEX IF NOT EXISTS idx_stages_actual_start ON prod_tracking.stages(actual_start_date) WHERE actual_start_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stages_overdue ON prod_tracking.stages(planned_start_date, status)
    WHERE actual_start_date IS NULL AND status = 'not_started';
CREATE INDEX IF NOT EXISTS idx_stages_order_sequence ON prod_tracking.stages(order_id, sequence_number);

CREATE INDEX IF NOT EXISTS idx_stage_logs_stage_id ON prod_tracking.stage_logs(stage_id);
CREATE INDEX IF NOT EXISTS idx_stage_logs_created_at ON prod_tracking.stage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_stage_logs_action ON prod_tracking.stage_logs(action);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON prod_tracking.users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON prod_tracking.users(role);

CREATE INDEX IF NOT EXISTS idx_notification_settings_user ON prod_tracking.notification_settings(user_id);

CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON prod_tracking.sync_queue(status) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_sync_queue_next_retry ON prod_tracking.sync_queue(next_retry_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_error_logs_module ON prod_tracking.error_logs(module);
CREATE INDEX IF NOT EXISTS idx_error_logs_level ON prod_tracking.error_logs(error_level);
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON prod_tracking.error_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_error_logs_unresolved ON prod_tracking.error_logs(created_at) WHERE is_resolved = false;

CREATE INDEX IF NOT EXISTS idx_bot_message_log_user ON prod_tracking.bot_message_log(user_id);
CREATE INDEX IF NOT EXISTS idx_bot_message_log_created ON prod_tracking.bot_message_log(created_at);
CREATE INDEX IF NOT EXISTS idx_bot_message_log_errors ON prod_tracking.bot_message_log(created_at) WHERE is_success = false;

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON SCHEMA prod_tracking IS 'Isolated production tracking schema for Telegram bot, CRM sync, and Gantt reporting.';

COMMENT ON TABLE prod_tracking.workshops IS 'Production workshops used to group orders and workshop heads.';
COMMENT ON TABLE prod_tracking.users IS 'Telegram users who interact with production tracking bot.';
COMMENT ON TABLE prod_tracking.orders IS 'Production orders synchronized with CRM and shown on Gantt charts.';
COMMENT ON TABLE prod_tracking.stages IS 'Ordered production stages with planned and actual dates.';
COMMENT ON TABLE prod_tracking.stage_logs IS 'Append-only audit log of all stage actions and bot/system events.';
COMMENT ON TABLE prod_tracking.notification_settings IS 'Per-user notification preferences for Telegram bot.';
COMMENT ON TABLE prod_tracking.escalation_rules IS 'Overdue warning and escalation rules by workshop or globally.';
COMMENT ON TABLE prod_tracking.sync_queue IS 'Outgoing queue for synchronizing local production changes to CRM.';
COMMENT ON TABLE prod_tracking.error_logs IS 'System error log for bot, escalation, and CRM sync services.';
COMMENT ON TABLE prod_tracking.bot_message_log IS 'Telegram bot message log for debugging incoming and outgoing messages.';

COMMENT ON COLUMN prod_tracking.users.telegram_id IS 'Telegram user ID used to bind messages and callbacks to a local user.';
COMMENT ON COLUMN prod_tracking.users.notification_enabled IS 'Whether this user receives bot notifications.';
COMMENT ON COLUMN prod_tracking.orders.crm_order_id IS 'External CRM order identifier for synchronization.';
COMMENT ON COLUMN prod_tracking.orders.status IS 'Current production order status, partially derived from stage statuses.';
COMMENT ON COLUMN prod_tracking.stages.planned_start_date IS 'Planned stage start date used by Gantt and overdue checks.';
COMMENT ON COLUMN prod_tracking.stages.planned_end_date IS 'Planned stage end date used by Gantt and overdue checks.';
COMMENT ON COLUMN prod_tracking.stages.actual_start_date IS 'Actual stage start date recorded by Telegram bot or manual input.';
COMMENT ON COLUMN prod_tracking.stages.actual_end_date IS 'Actual stage completion date recorded by Telegram bot or manual input.';
COMMENT ON COLUMN prod_tracking.stages.crm_stage_id IS 'External CRM stage identifier for synchronization.';
COMMENT ON COLUMN prod_tracking.stage_logs.metadata IS 'Additional event payload such as recognized voice text, file names, and Telegram metadata.';
COMMENT ON COLUMN prod_tracking.sync_queue.payload IS 'JSONB payload to send to CRM sync worker.';
COMMENT ON COLUMN prod_tracking.error_logs.context IS 'JSONB context for failed operation, such as stage_id, order_id, or telegram_message_id.';
COMMENT ON COLUMN prod_tracking.bot_message_log.content_preview IS 'First 500 characters of incoming or outgoing Telegram message content.';

-- =============================================================================
-- Triggers and functions
-- =============================================================================

CREATE OR REPLACE FUNCTION prod_tracking.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_users_updated_at ON prod_tracking.users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON prod_tracking.users
FOR EACH ROW
EXECUTE FUNCTION prod_tracking.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_orders_updated_at ON prod_tracking.orders;
CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON prod_tracking.orders
FOR EACH ROW
EXECUTE FUNCTION prod_tracking.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_stages_updated_at ON prod_tracking.stages;
CREATE TRIGGER trg_stages_updated_at
BEFORE UPDATE ON prod_tracking.stages
FOR EACH ROW
EXECUTE FUNCTION prod_tracking.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_notification_settings_updated_at ON prod_tracking.notification_settings;
CREATE TRIGGER trg_notification_settings_updated_at
BEFORE UPDATE ON prod_tracking.notification_settings
FOR EACH ROW
EXECUTE FUNCTION prod_tracking.update_updated_at_column();

CREATE OR REPLACE FUNCTION prod_tracking.update_order_status_from_stages()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    v_order_id INTEGER;
    v_total_count INTEGER;
    v_completed_count INTEGER;
    v_in_progress_count INTEGER;
    v_next_status VARCHAR(20);
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_order_id := OLD.order_id;
    ELSE
        v_order_id := NEW.order_id;
    END IF;

    IF v_order_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT
        COUNT(*)::INTEGER,
        COUNT(*) FILTER (WHERE status = 'completed')::INTEGER,
        COUNT(*) FILTER (WHERE status = 'in_progress')::INTEGER
    INTO v_total_count, v_completed_count, v_in_progress_count
    FROM prod_tracking.stages
    WHERE order_id = v_order_id;

    IF v_in_progress_count > 0 THEN
        v_next_status := 'in_progress';
    ELSIF v_total_count > 0 AND v_completed_count = v_total_count THEN
        v_next_status := 'completed';
    ELSE
        v_next_status := 'planned';
    END IF;

    UPDATE prod_tracking.orders
    SET status = v_next_status
    WHERE id = v_order_id
      AND status <> 'cancelled'
      AND status IS DISTINCT FROM v_next_status;

    RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_stages_update_order_status ON prod_tracking.stages;
CREATE TRIGGER trg_stages_update_order_status
AFTER INSERT OR UPDATE OR DELETE ON prod_tracking.stages
FOR EACH ROW
EXECUTE FUNCTION prod_tracking.update_order_status_from_stages();

CREATE OR REPLACE FUNCTION prod_tracking.cleanup_old_logs()
RETURNS JSONB
LANGUAGE plpgsql
AS $function$
DECLARE
    v_error_logs_deleted INTEGER := 0;
    v_bot_messages_deleted INTEGER := 0;
    v_stage_logs_deleted INTEGER := 0;
BEGIN
    DELETE FROM prod_tracking.bot_message_log
    WHERE created_at < NOW() - INTERVAL '30 days';
    GET DIAGNOSTICS v_bot_messages_deleted = ROW_COUNT;

    DELETE FROM prod_tracking.stage_logs
    WHERE created_at < NOW() - INTERVAL '365 days';
    GET DIAGNOSTICS v_stage_logs_deleted = ROW_COUNT;

    UPDATE prod_tracking.bot_message_log
    SET error_log_id = NULL
    WHERE error_log_id IN (
        SELECT id
        FROM prod_tracking.error_logs
        WHERE created_at < NOW() - INTERVAL '90 days'
    );

    DELETE FROM prod_tracking.error_logs
    WHERE created_at < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS v_error_logs_deleted = ROW_COUNT;

    RETURN jsonb_build_object(
        'error_logs_deleted', v_error_logs_deleted,
        'bot_message_log_deleted', v_bot_messages_deleted,
        'stage_logs_deleted', v_stage_logs_deleted
    );
END;
$function$;

COMMENT ON FUNCTION prod_tracking.cleanup_old_logs() IS
    'Deletes old logs: error_logs older than 90 days, bot_message_log older than 30 days, stage_logs older than 365 days. Run via pg_cron or an external scheduler.';

-- =============================================================================
-- Seed data
-- =============================================================================

INSERT INTO prod_tracking.workshops (name, description) VALUES
    ('Цех 1', 'Основной производственный цех'),
    ('Цех 2', 'Цех покраски и финишной обработки')
ON CONFLICT (name) DO NOTHING;

-- Global escalation rules are intentionally not seeded here:
-- escalation_target_user_id must reference an existing prod_tracking.users director.
