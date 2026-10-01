ALTER TABLE game_players ADD COLUMN IF NOT EXISTS score integer;
CREATE INDEX IF NOT EXISTS games_chat_mode_grid_idx ON games (chat_id, mode, grid);
