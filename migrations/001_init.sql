CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code         text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  total_rounds      integer NOT NULL,
  rounds_completed  integer NOT NULL DEFAULT 0,
  facilitator_name  text,
  player_count      integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS sessions_created_at_idx ON sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_room_code_idx  ON sessions (room_code);

CREATE TABLE IF NOT EXISTS responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  round_number    integer NOT NULL,
  scenario_index  integer NOT NULL,
  scenario_text   text NOT NULL,
  player_id       text NOT NULL,
  player_name     text NOT NULL,
  initial_vote    text CHECK (initial_vote  IN ('erode','depends','support')),
  reason_text     text,
  revised_vote    text CHECK (revised_vote  IN ('erode','depends','support')),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, round_number, player_id)
);

CREATE INDEX IF NOT EXISTS responses_session_round_idx ON responses (session_id, round_number);
CREATE INDEX IF NOT EXISTS responses_scenario_idx      ON responses (scenario_index);
CREATE INDEX IF NOT EXISTS responses_recorded_at_idx   ON responses (recorded_at);
