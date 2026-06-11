-- Run once against tocktest_db (synchronize is off)
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  default_page_size INT NOT NULL DEFAULT 20,
  email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  preferred_language VARCHAR(5) NOT NULL DEFAULT 'th',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);
