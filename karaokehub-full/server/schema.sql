-- ============================================================
-- KaraokeHub SQLite Schema
-- Run automatically by server/db.js on first boot.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ---------- USERS ----------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname      TEXT NOT NULL UNIQUE,
  avatar        TEXT DEFAULT '🎤',
  email         TEXT UNIQUE,
  password_hash TEXT,               -- NULL for guest users
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  points        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- SONGS ----------
CREATE TABLE IF NOT EXISTS songs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  song_number     TEXT NOT NULL UNIQUE,      -- e.g. "10001" (the "song number" search field)
  title           TEXT NOT NULL,
  artist          TEXT NOT NULL,
  language        TEXT NOT NULL DEFAULT 'English',
  genre           TEXT,
  duration_sec    INTEGER NOT NULL DEFAULT 0,
  youtube_video_id TEXT NOT NULL,
  thumbnail_url   TEXT,
  search_keywords TEXT,               -- extra free-text keywords for search
  view_count      INTEGER NOT NULL DEFAULT 0,
  play_count      INTEGER NOT NULL DEFAULT 0,
  favorite_count  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Full text search index over songs (title / artist / keywords / song_number)
CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
  title, artist, search_keywords, song_number,
  content='songs', content_rowid='id'
);

-- keep fts index in sync
CREATE TRIGGER IF NOT EXISTS songs_ai AFTER INSERT ON songs BEGIN
  INSERT INTO songs_fts(rowid, title, artist, search_keywords, song_number)
  VALUES (new.id, new.title, new.artist, new.search_keywords, new.song_number);
END;
CREATE TRIGGER IF NOT EXISTS songs_ad AFTER DELETE ON songs BEGIN
  INSERT INTO songs_fts(songs_fts, rowid, title, artist, search_keywords, song_number)
  VALUES ('delete', old.id, old.title, old.artist, old.search_keywords, old.song_number);
END;
CREATE TRIGGER IF NOT EXISTS songs_au AFTER UPDATE ON songs BEGIN
  INSERT INTO songs_fts(songs_fts, rowid, title, artist, search_keywords, song_number)
  VALUES ('delete', old.id, old.title, old.artist, old.search_keywords, old.song_number);
  INSERT INTO songs_fts(rowid, title, artist, search_keywords, song_number)
  VALUES (new.id, new.title, new.artist, new.search_keywords, new.song_number);
END;

-- ---------- LYRICS (synced lines per song) ----------
CREATE TABLE IF NOT EXISTS lyrics_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id     INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  start_ms    INTEGER NOT NULL,   -- when this line should appear
  end_ms      INTEGER NOT NULL,
  line_text   TEXT NOT NULL,
  line_order  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lyrics_song ON lyrics_lines(song_id, line_order);

-- ---------- ROOMS (a "TV" / karaoke session, supports multi-room) ----------
CREATE TABLE IF NOT EXISTS rooms (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code     TEXT NOT NULL UNIQUE,      -- used in the QR-code pairing URL
  name          TEXT NOT NULL DEFAULT 'Main Room',
  admin_user_id INTEGER REFERENCES users(id),
  theme         TEXT NOT NULL DEFAULT 'dark',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- QUEUE ----------
CREATE TABLE IF NOT EXISTS queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  song_id     INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  singer_name TEXT NOT NULL DEFAULT 'Guest',
  user_id     INTEGER REFERENCES users(id),
  position    INTEGER NOT NULL,      -- ordering within the room's queue
  votes       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','playing','done','skipped')),
  added_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_queue_room ON queue(room_id, position);

-- ---------- FAVORITES ----------
CREATE TABLE IF NOT EXISTS favorites (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id  INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, song_id)
);

-- ---------- PLAY HISTORY ----------
CREATE TABLE IF NOT EXISTS play_history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id   INTEGER REFERENCES rooms(id),
  song_id   INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  user_id   INTEGER REFERENCES users(id),
  played_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_history_song ON play_history(song_id);
CREATE INDEX IF NOT EXISTS idx_history_user ON play_history(user_id);

-- ---------- MIC SESSIONS (phone-as-microphone pairing) ----------
CREATE TABLE IF NOT EXISTS mic_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id         INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  device_label    TEXT NOT NULL DEFAULT 'Phone',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','disconnected')),
  volume          INTEGER NOT NULL DEFAULT 80,
  echo            INTEGER NOT NULL DEFAULT 35,
  reverb          INTEGER NOT NULL DEFAULT 20,
  noise_gate      INTEGER NOT NULL DEFAULT 50,
  preset          TEXT NOT NULL DEFAULT 'KTV Room',
  connected_at    TEXT,
  disconnected_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- SCORES (optional AI karaoke scoring) ----------
CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id    INTEGER REFERENCES queue(id) ON DELETE SET NULL,
  song_id     INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  pitch       REAL,
  timing      REAL,
  vibrato     REAL,
  breath      REAL,
  expression  REAL,
  overall     REAL,
  grade       TEXT CHECK (grade IN ('S','A','B','C')),
  scored_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
