CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  host_hash TEXT NOT NULL,
  guest_hash TEXT,
  host_seen INTEGER NOT NULL,
  guest_seen INTEGER,
  state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rooms_updated_at ON rooms(updated_at);
