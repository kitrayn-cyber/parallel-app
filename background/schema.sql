CREATE TABLE IF NOT EXISTS chat_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 role TEXT NOT NULL CHECK(role IN ('user','model')),
 text TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS outgoing_jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 last_message_id INTEGER NOT NULL,
 due_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','done')),
 attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS jobs_due ON outgoing_jobs(state,due_at);
