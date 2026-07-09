const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'karaokehub.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run schema.sql (idempotent - all statements use IF NOT EXISTS)
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Ensure at least one room exists (the default "TV")
const room = db.prepare('SELECT * FROM rooms LIMIT 1').get();
if (!room) {
  db.prepare(`INSERT INTO rooms (room_code, name, theme) VALUES (?, ?, ?)`)
    .run('demo123', 'Main Room', 'dark');
}

module.exports = db;
