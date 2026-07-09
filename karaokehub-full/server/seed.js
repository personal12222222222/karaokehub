// Seeds the database with sample songs so the app has data to show on first run.
// Run with: npm run seed
const db = require('./db');

const songs = [
  { num: "10001", title: "My Way", artist: "Frank Sinatra", lang: "English", genre: "Classic", dur: 276, vid: "qQzdAsjWGPg" },
  { num: "10002", title: "Hallelujah", artist: "Jeff Buckley", lang: "English", genre: "Ballad", dur: 413, vid: "y8AWFf7EAc4" },
  { num: "10003", title: "Perfect", artist: "Ed Sheeran", lang: "English", genre: "Pop", dur: 263, vid: "2Vv-BfVoq4g" },
  { num: "10004", title: "Shape of You", artist: "Ed Sheeran", lang: "English", genre: "Pop", dur: 233, vid: "JGwWNGJdvx8" },
  { num: "10005", title: "Ako'y Sa'yo", artist: "OPM Classics", lang: "Filipino", genre: "OPM", dur: 242, vid: "y6120QOlsfU" },
  { num: "10006", title: "Pangako", artist: "OPM Ballads", lang: "Filipino", genre: "OPM", dur: 255, vid: "y6120QOlsfU" },
  { num: "10007", title: "Lemon", artist: "Kenshi Yonezu", lang: "Japanese", genre: "J-Pop", dur: 256, vid: "SX_ViT4Ra7k" },
  { num: "10008", title: "Dynamite", artist: "BTS", lang: "Korean", genre: "K-Pop", dur: 199, vid: "gdZLi9oWNZg" },
  { num: "10009", title: "Yue Liang Dai Biao Wo De Xin", artist: "Teresa Teng", lang: "Chinese", genre: "Classic", dur: 190, vid: "IcrbM1l_BoI" },
  { num: "10010", title: "Despacito", artist: "Luis Fonsi", lang: "Spanish", genre: "Latin", dur: 228, vid: "kJQP7kiw5Fk" },
  { num: "10011", title: "Someone Like You", artist: "Adele", lang: "English", genre: "Ballad", dur: 285, vid: "hLQl3WQQoQ0" },
  { num: "10012", title: "Bohemian Rhapsody", artist: "Queen", lang: "English", genre: "Rock", dur: 355, vid: "fJ9rUzIMcZQ" },
];

const insertSong = db.prepare(`
  INSERT OR IGNORE INTO songs
    (song_number, title, artist, language, genre, duration_sec, youtube_video_id, search_keywords, view_count, play_count, favorite_count)
  VALUES (@num, @title, @artist, @lang, @genre, @dur, @vid, @keywords, @views, @plays, @favs)
`);

const insertMany = db.transaction((rows) => {
  for (const s of rows) {
    insertSong.run({
      ...s,
      keywords: `${s.title} ${s.artist} ${s.lang} ${s.genre}`.toLowerCase(),
      views: Math.floor(Math.random() * 5_000_000 + 50_000),
      plays: Math.floor(Math.random() * 5000 + 100),
      favs: Math.floor(Math.random() * 500),
    });
  }
});

insertMany(songs);

console.log(`Seeded ${db.prepare('SELECT COUNT(*) c FROM songs').get().c} songs into the database.`);
