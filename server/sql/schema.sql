CREATE TABLE IF NOT EXISTS auth_requests (
  state TEXT PRIMARY KEY,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  expires_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  state TEXT NOT NULL REFERENCES auth_requests(state),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP
);
