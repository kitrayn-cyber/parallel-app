-- Parallel D1 schema v1
-- Apply in Cloudflare D1 console; never expose the database to browser JavaScript.
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK(sender IN ('kit','gura')),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deliver_at INTEGER,
  status TEXT NOT NULL DEFAULT 'delivered' CHECK(status IN ('queued','delivered','failed'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_time ON messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS idx_messages_due ON messages(status,deliver_at);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Later: scheduled Worker jobs for delayed delivery, and device push subscriptions.
