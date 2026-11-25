CREATE TABLE IF NOT EXISTS attendance_app_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO attendance_app_state (id, payload)
VALUES (1, '{"admins":[],"employees":[],"attendance":[],"leaves":[]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS attendance_sessions (
  session_id_hash text PRIMARY KEY,
  csrf_token text NOT NULL,
  user_role text CHECK (user_role IS NULL OR user_role IN ('admin', 'employee')),
  user_id text,
  user_name text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attendance_sessions_expires_at_idx
  ON attendance_sessions (expires_at);

ALTER TABLE attendance_app_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE attendance_app_state FROM anon, authenticated;
REVOKE ALL ON TABLE attendance_sessions FROM anon, authenticated;
