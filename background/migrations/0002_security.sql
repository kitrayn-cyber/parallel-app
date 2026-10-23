-- Additive authentication metadata only. No existing data/bindings/keys changed.
CREATE TABLE IF NOT EXISTS security_sessions (
 token_hash TEXT PRIMARY KEY,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS security_session_expiry ON security_sessions(expires_at);
CREATE TABLE IF NOT EXISTS security_rate_limits (
 bucket TEXT PRIMARY KEY,
 expires_at INTEGER NOT NULL,
 requests INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS security_rate_expiry ON security_rate_limits(expires_at);
