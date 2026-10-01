ALTER TABLE game_players ADD COLUMN IF NOT EXISTS ready_at timestamptz;
CREATE INDEX IF NOT EXISTS games_mode_status_idx ON games (mode, status);
