-- Run once against tocktest_db (synchronize is off)
ALTER TABLE github_tokens ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'pat';
ALTER TABLE github_tokens ADD COLUMN IF NOT EXISTS github_login VARCHAR(255);
ALTER TABLE github_tokens ADD COLUMN IF NOT EXISTS github_user_id BIGINT;

CREATE TABLE IF NOT EXISTS github_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id BIGINT NOT NULL UNIQUE,
  account_login VARCHAR(255),
  account_type VARCHAR(50),
  repository_selection VARCHAR(50),
  suspended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_installations_user_id ON github_installations(user_id);

CREATE TABLE IF NOT EXISTS github_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id BIGINT,
  event VARCHAR(100) NOT NULL,
  action VARCHAR(100),
  repo_full_name VARCHAR(255),
  delivery_id VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'received',
  payload JSONB,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_webhook_events_repo ON github_webhook_events(repo_full_name);
