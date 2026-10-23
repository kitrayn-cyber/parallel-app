-- Additive: never alters/deletes existing messages, memories, or prototype tables.
CREATE TABLE IF NOT EXISTS bg_conversations (
 id TEXT PRIMARY KEY, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bg_messages (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 conversation_id TEXT NOT NULL REFERENCES bg_conversations(id),
 role TEXT NOT NULL CHECK(role IN ('user','model')),
 text TEXT NOT NULL, photo TEXT, created_at INTEGER NOT NULL,
 notes TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS bg_history ON bg_messages(conversation_id,seq);
CREATE TABLE IF NOT EXISTS bg_jobs (
 id TEXT PRIMARY KEY REFERENCES bg_messages(id),
 conversation_id TEXT NOT NULL, message_seq INTEGER NOT NULL,
 due_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','done','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0, token TEXT,
 last_error TEXT
);
CREATE INDEX IF NOT EXISTS bg_due ON bg_jobs(state,due_at);
CREATE TABLE IF NOT EXISTS bg_subscriptions (
 endpoint TEXT PRIMARY KEY, subscription TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bg_push (
 message_id TEXT NOT NULL, endpoint TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 due_at INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, token TEXT,
 PRIMARY KEY(message_id,endpoint)
);
CREATE TABLE IF NOT EXISTS bg_daily_usage (
 day TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0
);
