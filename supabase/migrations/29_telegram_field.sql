ALTER TABLE users
  ADD COLUMN IF NOT EXISTS telegram_chat_id text;
