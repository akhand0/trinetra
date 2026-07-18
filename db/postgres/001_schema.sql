CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS episodes
(
  id UUID PRIMARY KEY,
  chat_id TEXT NOT NULL,
  query TEXT NOT NULL,
  context_bucket TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'resolved', 'abandoned')),
  root_cause_confirmed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS episodes_chat_id_idx
  ON episodes (chat_id, started_at DESC);

CREATE TABLE IF NOT EXISTS policy_decisions
(
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  step INTEGER NOT NULL,
  arm TEXT NOT NULL,
  sampled_score REAL NOT NULL CHECK (sampled_score BETWEEN 0 AND 1),
  propensity REAL NOT NULL CHECK (propensity > 0 AND propensity <= 1),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (episode_id, step)
);

CREATE TABLE IF NOT EXISTS annotations
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
