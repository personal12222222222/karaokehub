# KaraokeHub — Full Stack Package

Browser-based karaoke system: Express + SQLite backend, static frontend, WebSocket live updates.

## Stack
- **Backend:** Node.js + Express
- **Database:** SQLite (via `better-sqlite3`), schema in `server/schema.sql`
- **Realtime:** `ws` WebSocket server (queue updates, mic pairing status)
- **Frontend:** static HTML/CSS/JS in `public/` (no build step), talks to the API with `fetch`
- **Search:** SQLite FTS5 full-text index over songs, with a LIKE-based fallback

## Project layout
```
karaokehub-full/
├── package.json
├── server/
│   ├── index.js       # Express app + REST API + WebSocket server
│   ├── db.js           # opens the SQLite file, runs schema.sql on boot
│   ├── schema.sql       # CREATE TABLE statements (see below)
│   └── seed.js          # inserts sample songs
├── public/
│   └── index.html       # the whole frontend (fetches data from /api/*)
└── data/
    └── karaokehub.db     # created automatically on first run
```

## Run it locally
```bash
npm install
npm run seed      # creates data/karaokehub.db and inserts sample songs (run once)
npm start         # starts the server on http://localhost:3000
```
Open `http://localhost:3000` in a browser — the frontend is served by Express itself, so frontend and backend are on the same origin (no CORS issues).

## Deploying ("making it live")
This is a single Node process + a SQLite file, so it runs anywhere Node runs:

1. **VPS / Raspberry Pi / home server** (matches the original brief):
   - Copy the whole folder to the machine, run `npm install --production`, `npm run seed` once, then `npm start`.
   - Put it behind Nginx as a reverse proxy for HTTPS (needed for `getUserMedia`/microphone access on phones) and to serve on port 80/443.
   - Use `pm2` or a systemd service to keep it running: `pm2 start server/index.js --name karaokehub`.
2. **Any Node hosting (Render, Railway, Fly.io, a droplet, etc.)**:
   - Set the start command to `npm start`.
   - Because `data/karaokehub.db` is a file, make sure the host gives you a **persistent disk/volume** — on ephemeral filesystems the DB resets on every deploy. Mount a volume at `data/`.
3. **Docker** (matches the brief's tech stack):
   ```dockerfile
   FROM node:20-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm install --production
   COPY . .
   RUN npm run seed
   EXPOSE 3000
   CMD ["npm", "start"]
   ```
   Mount `./data` as a volume so the database survives container restarts.

## Database schema (SQLite)
All `CREATE TABLE` statements live in `server/schema.sql` and run automatically (idempotently) every time the server boots — you don't need to run them by hand. Tables:

- `users` — nickname, avatar, role, points
- `songs` — title, artist, language, genre, YouTube video id, view/play/favorite counts
- `songs_fts` — FTS5 virtual table + triggers, powers `/api/songs/search`
- `lyrics_lines` — synced lyric lines per song (start_ms/end_ms + text)
- `rooms` — one row per "TV"/karaoke session, holds the `room_code` used in the QR pairing link
- `queue` — per-room song queue with position, votes, singer name
- `favorites` — user↔song many-to-many
- `play_history` — every play event, powers "Recently Played"
- `mic_sessions` — phone pairing state (pending/connected/disconnected) + echo/reverb/volume settings
- `scores` — optional AI karaoke scoring (pitch/timing/vibrato/breath/expression/grade)

To inspect the DB directly:
```bash
sqlite3 data/karaokehub.db
.tables
.schema songs
SELECT * FROM songs LIMIT 5;
```

## Troubleshooting: "npm error path .../src/package.json (ENOENT)"

This means Render is looking for `package.json` in the wrong folder — almost always because when you unzipped and pushed to GitHub, an extra folder level got included, e.g. your repo looks like:
```
karaokehub/
└── karaokehub-full/     <-- package.json is one level too deep
    ├── package.json
    ├── server/
    └── public/
```
Render expects `package.json` at the **repo root** by default. Fix it one of two ways:

**Option A — set the Root Directory in Render (easiest, no re-push needed):**
1. Render dashboard → your service → **Settings**
2. Find **Root Directory** → set it to `karaokehub-full`
3. Save → **Manual Deploy** → Deploy latest commit

**Option B — flatten the repo so package.json is at the root:**
```bash
# from inside the unzipped karaokehub-full folder
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/karaokehub.git
git push -u origin main
```
Note there's no `karaokehub-full` folder in this repo — the *contents* of that folder become the repo root. That's the setup this README's earlier instructions assume.

Either way, after fixing, the build command `npm install && npm run seed` should find `package.json` immediately.


| Method | Path | Purpose |
|---|---|---|
| GET | `/api/songs?sort=popular\|trending&limit=` | list songs |
| GET | `/api/songs/search?q=` | search title/artist/song number/keywords |
| GET | `/api/songs/:id` | song detail + lyrics |
| POST | `/api/songs/:id/play` | log a play, bump play_count |
| GET | `/api/history/recent` | recently played |
| POST/DELETE | `/api/favorites` | add/remove favorite `{user_id, song_id}` |
| GET | `/api/favorites/:user_id` | a user's favorites |
| GET | `/api/queue?room_id=` | current queue |
| POST | `/api/queue` | add to queue `{room_id, song_id, singer_name, user_id}` |
| DELETE | `/api/queue/:id` | remove from queue |
| POST | `/api/queue/:id/vote` | upvote a queued song |
| POST | `/api/queue/reorder` | reorder `{room_id, ordered_ids:[]}` |
| POST | `/api/mic/pair` | start a QR pairing session `{room_id}` |
| POST | `/api/mic/:id/connect` | mark a mic session connected |
| POST | `/api/mic/:id/settings` | update volume/echo/reverb/noise_gate/preset |
| POST | `/api/mic/:id/disconnect` | mark disconnected |
| POST | `/api/users` | create a guest/user `{nickname, avatar}` |
| GET | `/api/rooms/default` | the default room (used for the QR code) |

WebSocket at `/ws` broadcasts `queue_updated`, `mic_connected`, `mic_disconnected`, `mic_settings_updated`, `now_playing` — the frontend listens and refreshes the relevant UI live, so a second browser tab (e.g. an admin view) stays in sync automatically.

## What's real vs. simulated
- Real: song database, search, queue, favorites, play history, theming, mic pairing state (rounds through SQLite), **and now a real microphone**: click "Use Headset / Built-in Mic" in the mic modal — this uses the browser's actual `getUserMedia` + Web Audio API to capture your mic and apply live echo (delay+feedback) and reverb (convolution) effects, output straight to your headset in real time. Sliders control volume/echo/reverb/gate live.
  - ⚠️ **Use a headset, not open speakers** — an open mic next to speakers playing the processed vocal will howl with feedback. A headset (mic input + earphone output) keeps the loop closed and safe.
  - ⚠️ **Requires HTTPS** (or `localhost`) — browsers block microphone access on plain `http://` for any other host, so this only works once deployed with a real HTTPS URL (Render gives you this automatically) or when testing locally.
- Still simulated: **phone-as-wireless-mic** via QR code. The QR still generates and the pairing session still gets created in the database, but there's no page yet at the URL it encodes. Making that real needs a phone-side web page (`getUserMedia` + `RTCPeerConnection`) and a WebRTC signaling relay between phone and TV — the `mic_sessions` table and `/api/mic/*` routes are already built to support that flow once that phone page exists.
