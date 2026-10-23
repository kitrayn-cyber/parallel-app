-- Additive only. Existing conversations, memories, jobs and subscriptions stay intact.
CREATE TABLE IF NOT EXISTS life_weeks (
  character_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  version INTEGER NOT NULL,
  blocks TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(character_id,week_start)
);
