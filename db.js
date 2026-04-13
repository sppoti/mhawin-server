const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Создаём папку data если нет
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// База данных
const dbPath = path.join(dataDir, 'mhawin.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Создаём таблицы
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    tg_id INTEGER PRIMARY KEY,
    username TEXT,
    balance INTEGER DEFAULT 10000,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS daily_scores (
    tg_id INTEGER,
    score INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    date TEXT,
    PRIMARY KEY (tg_id, date),
    FOREIGN KEY (tg_id) REFERENCES users(tg_id) ON DELETE CASCADE
  );
`);

module.exports = db;
