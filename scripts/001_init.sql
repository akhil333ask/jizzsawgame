CREATE TABLE IF NOT EXISTS players (
  id bigint PRIMARY KEY,
  name text NOT NULL,
  username text,
  wins integer NOT NULL DEFAULT 0,
  games integer NOT NULL DEFAULT 0,
  solo_solved integer NOT NULL DEFAULT 0,
  best_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS games (
  id text PRIMARY KEY,
  mode text NOT NULL,
  status text NOT NULL,
  pokemon_id integer NOT NULL,
  grid integer NOT NULL,
  max_players integer NOT NULL DEFAULT 1,
  host_id bigint NOT NULL,
  chat_id bigint,
  message_id integer,
  inline_message_id text,
  perm jsonb,
  lobby_deadline timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  winner_id bigint,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_players (
  game_id text NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id bigint NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  board jsonb,
  moves integer NOT NULL DEFAULT 0,
  correct integer NOT NULL DEFAULT 0,
  last_move_at timestamptz,
  burst integer NOT NULL DEFAULT 0,
  finished_at timestamptz,
  solve_ms integer,
  flagged boolean NOT NULL DEFAULT false,
  flag_reason text,
  PRIMARY KEY (game_id, player_id)
);

CREATE INDEX IF NOT EXISTS games_status_idx ON games (status);
CREATE INDEX IF NOT EXISTS games_chat_idx ON games (chat_id);
CREATE INDEX IF NOT EXISTS game_players_player_idx ON game_players (player_id);
CREATE INDEX IF NOT EXISTS players_leaderboard_idx ON players (wins DESC);
