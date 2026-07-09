const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Broadcast helper - pushes live updates (queue changes, mic status) to every connected screen
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

const DEFAULT_ROOM_ID = () => db.prepare('SELECT id FROM rooms ORDER BY id LIMIT 1').get().id;

// ---------------------------------------------------------------
// SONGS
// ---------------------------------------------------------------

// GET /api/songs - list songs (supports ?sort=popular|recent)
app.get('/api/songs', (req, res) => {
  const sort = req.query.sort;
  let order = 'ORDER BY created_at DESC';
  if (sort === 'popular') order = 'ORDER BY play_count DESC';
  if (sort === 'trending') order = 'ORDER BY view_count DESC';
  const rows = db.prepare(`SELECT * FROM songs ${order} LIMIT ?`).all(Number(req.query.limit) || 20);
  res.json(rows);
});

// GET /api/songs/search?q=... - search by title, artist, song number, or partial match
app.get('/api/songs/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  // Try FTS first (handles partial word matches well via prefix query)
  const ftsQuery = q.split(/\s+/).map((t) => `${t.replace(/[^a-zA-Z0-9]/g, '')}*`).join(' ');
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT songs.* FROM songs_fts
      JOIN songs ON songs.id = songs_fts.rowid
      WHERE songs_fts MATCH ?
      ORDER BY songs.play_count DESC
      LIMIT 30
    `).all(ftsQuery);
  } catch (e) {
    rows = [];
  }

  // Fallback: plain LIKE search (also covers direct song-number lookups)
  if (rows.length === 0) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT * FROM songs
      WHERE title LIKE ? OR artist LIKE ? OR song_number LIKE ? OR search_keywords LIKE ?
      ORDER BY play_count DESC
      LIMIT 30
    `).all(like, like, like, like);
  }
  res.json(rows);
});

// GET /api/songs/:id - single song + lyrics
app.get('/api/songs/:id', (req, res) => {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!song) return res.status(404).json({ error: 'Song not found' });
  const lyrics = db.prepare('SELECT * FROM lyrics_lines WHERE song_id = ? ORDER BY line_order').all(req.params.id);
  res.json({ ...song, lyrics });
});

// POST /api/songs/:id/play - increments play_count, logs history, bumps queue item to done
app.post('/api/songs/:id/play', (req, res) => {
  db.prepare('UPDATE songs SET play_count = play_count + 1 WHERE id = ?').run(req.params.id);
  db.prepare('INSERT INTO play_history (room_id, song_id, user_id) VALUES (?, ?, ?)')
    .run(DEFAULT_ROOM_ID(), req.params.id, req.body.user_id || null);
  broadcast('now_playing', { song_id: Number(req.params.id) });
  res.json({ ok: true });
});

// GET /api/songs/history/recent
app.get('/api/history/recent', (req, res) => {
  const rows = db.prepare(`
    SELECT songs.* FROM play_history
    JOIN songs ON songs.id = play_history.song_id
    ORDER BY play_history.played_at DESC
    LIMIT 8
  `).all();
  res.json(rows);
});

// ---------------------------------------------------------------
// FAVORITES
// ---------------------------------------------------------------
app.post('/api/favorites', (req, res) => {
  const { user_id, song_id } = req.body;
  db.prepare('INSERT OR IGNORE INTO favorites (user_id, song_id) VALUES (?, ?)').run(user_id, song_id);
  db.prepare('UPDATE songs SET favorite_count = favorite_count + 1 WHERE id = ?').run(song_id);
  res.json({ ok: true });
});
app.delete('/api/favorites', (req, res) => {
  const { user_id, song_id } = req.body;
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND song_id = ?').run(user_id, song_id);
  db.prepare('UPDATE songs SET favorite_count = MAX(favorite_count - 1, 0) WHERE id = ?').run(song_id);
  res.json({ ok: true });
});
app.get('/api/favorites/:user_id', (req, res) => {
  const rows = db.prepare(`
    SELECT songs.* FROM favorites
    JOIN songs ON songs.id = favorites.song_id
    WHERE favorites.user_id = ?
  `).all(req.params.user_id);
  res.json(rows);
});

// ---------------------------------------------------------------
// QUEUE
// ---------------------------------------------------------------
app.get('/api/queue', (req, res) => {
  const roomId = req.query.room_id || DEFAULT_ROOM_ID();
  const rows = db.prepare(`
    SELECT queue.*, songs.title, songs.artist, songs.duration_sec, songs.youtube_video_id
    FROM queue JOIN songs ON songs.id = queue.song_id
    WHERE queue.room_id = ? AND queue.status = 'waiting'
    ORDER BY queue.position ASC
  `).all(roomId);
  res.json(rows);
});

app.post('/api/queue', (req, res) => {
  const roomId = req.body.room_id || DEFAULT_ROOM_ID();
  const { song_id, singer_name, user_id } = req.body;
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), 0) m FROM queue WHERE room_id = ?').get(roomId).m;
  const info = db.prepare(`
    INSERT INTO queue (room_id, song_id, singer_name, user_id, position)
    VALUES (?, ?, ?, ?, ?)
  `).run(roomId, song_id, singer_name || 'Guest', user_id || null, maxPos + 1);
  broadcast('queue_updated', { room_id: roomId });
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/queue/:id', (req, res) => {
  db.prepare('DELETE FROM queue WHERE id = ?').run(req.params.id);
  broadcast('queue_updated', { room_id: DEFAULT_ROOM_ID() });
  res.json({ ok: true });
});

app.post('/api/queue/:id/vote', (req, res) => {
  db.prepare('UPDATE queue SET votes = votes + 1 WHERE id = ?').run(req.params.id);
  broadcast('queue_updated', { room_id: DEFAULT_ROOM_ID() });
  res.json({ ok: true });
});

// reorder: body = { room_id, ordered_ids: [queueId, queueId, ...] }
app.post('/api/queue/reorder', (req, res) => {
  const { room_id, ordered_ids } = req.body;
  const stmt = db.prepare('UPDATE queue SET position = ? WHERE id = ?');
  const tx = db.transaction((ids) => { ids.forEach((id, i) => stmt.run(i + 1, id)); });
  tx(ordered_ids);
  broadcast('queue_updated', { room_id });
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// MIC SESSIONS (QR phone pairing)
// ---------------------------------------------------------------
app.post('/api/mic/pair', (req, res) => {
  const roomId = req.body.room_id || DEFAULT_ROOM_ID();
  const info = db.prepare(`
    INSERT INTO mic_sessions (room_id, device_label, status)
    VALUES (?, ?, 'pending')
  `).run(roomId, req.body.device_label || 'Phone');
  res.json({ mic_session_id: info.lastInsertRowid, room_code: db.prepare('SELECT room_code FROM rooms WHERE id = ?').get(roomId).room_code });
});

app.post('/api/mic/:id/connect', (req, res) => {
  db.prepare(`UPDATE mic_sessions SET status = 'connected', connected_at = datetime('now') WHERE id = ?`).run(req.params.id);
  const session = db.prepare('SELECT * FROM mic_sessions WHERE id = ?').get(req.params.id);
  broadcast('mic_connected', session);
  res.json(session);
});

app.post('/api/mic/:id/settings', (req, res) => {
  const { volume, echo, reverb, noise_gate, preset } = req.body;
  db.prepare(`
    UPDATE mic_sessions SET volume = ?, echo = ?, reverb = ?, noise_gate = ?, preset = ? WHERE id = ?
  `).run(volume, echo, reverb, noise_gate, preset, req.params.id);
  broadcast('mic_settings_updated', { id: req.params.id, volume, echo, reverb, noise_gate, preset });
  res.json({ ok: true });
});

app.post('/api/mic/:id/disconnect', (req, res) => {
  db.prepare(`UPDATE mic_sessions SET status = 'disconnected', disconnected_at = datetime('now') WHERE id = ?`).run(req.params.id);
  broadcast('mic_disconnected', { id: Number(req.params.id) });
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// USERS
// ---------------------------------------------------------------
app.post('/api/users', (req, res) => {
  const { nickname, avatar } = req.body;
  const info = db.prepare('INSERT INTO users (nickname, avatar) VALUES (?, ?)').run(nickname, avatar || '🎤');
  res.json({ id: info.lastInsertRowid, nickname, avatar });
});
app.get('/api/users/:id', (req, res) => {
  const user = db.prepare('SELECT id, nickname, avatar, points, role FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});

// ---------------------------------------------------------------
// ROOMS
// ---------------------------------------------------------------
app.get('/api/rooms/default', (req, res) => {
  res.json(db.prepare('SELECT * FROM rooms ORDER BY id LIMIT 1').get());
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`KaraokeHub server running at http://localhost:${PORT}`);
});
