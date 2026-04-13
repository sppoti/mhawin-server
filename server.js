require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./db');

const app = express();
app.use(express.json());

// CORS с явными настройками
app.use(cors({
  origin: '*', // Для отладки. В продакшене укажите ваш домен
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

// Обработка preflight запросов
app.options('*', (req, res) => {
  res.sendStatus(200);
});

// Логирование запросов (для отладки)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} from ${req.ip}`);
  next();
});

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error('❌ Укажите BOT_TOKEN в .env'); process.exit(1); }

// 🔐 Верификация initData Telegram
function verifyInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const dataCheck = [...params.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secret = crypto.createHash('sha256').update(BOT_TOKEN).digest();
    const hmac = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
    return hmac === hash;
  } catch (e) {
    console.error('Verify error:', e);
    return false;
  }
}

function getUserData(initData) {
  try {
    return JSON.parse(new URLSearchParams(initData).get('user') || '{}');
  } catch { return {}; }
}

const getTodayUTC = () => new Date().toISOString().split('T')[0];

// 1️⃣ Инициализация / Синхронизация
app.post('/api/verify', (req, res) => {
  try {
    const { initData } = req.body;
    if (!verifyInitData(initData)) {
      console.warn('❌ Invalid initData');
      return res.status(403).json({ error: 'Неверные данные Telegram' });
    }
    
    const user = getUserData(initData);
    if (!user.id) {
      console.warn('❌ No user ID');
      return res.status(400).json({ error: 'Нет ID пользователя' });
    }

    // Создаём пользователя если нет
    db.prepare('INSERT OR IGNORE INTO users (tg_id, username, balance) VALUES (?, ?, 10000)')
      .run(user.id, user.username || 'Игрок');
    
    const today = getTodayUTC();
    db.prepare('INSERT OR IGNORE INTO daily_scores (tg_id, date, score, wins) VALUES (?, ?, 0, 0)')
      .run(user.id, today);
    
    const dbUser = db.prepare('SELECT tg_id, username, balance FROM users WHERE tg_id = ?').get(user.id);
    const scoreRow = db.prepare('SELECT score, wins FROM daily_scores WHERE tg_id = ? AND date = ?').get(user.id, today);

    console.log(`✅ Verify: user ${user.id}`);
    res.json({ user: dbUser, score: scoreRow, date: today });
  } catch (e) {
    console.error('❌ /api/verify error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// 2️⃣ Отправка выигрыша — ИСПРАВЛЕНО
app.post('/api/submit', (req, res) => {
  try {
    const { initData, winAmount } = req.body;
    if (!verifyInitData(initData)) {
      console.warn('❌ Invalid initData on submit');
      return res.status(403).json({ error: 'Неверные данные' });
    }
    if (!Number.isInteger(winAmount) || winAmount <= 0) {
      console.warn('❌ Invalid winAmount:', winAmount);
      return res.status(400).json({ error: 'Неверная сумма' });
    }

    const user = getUserData(initData);
    const today = getTodayUTC();

    // ✅ Выполняем запросы ПО ОТДЕЛЬНОСТИ (лучшая практика для better-sqlite3)
    db.prepare('UPDATE users SET balance = balance + ? WHERE tg_id = ?')
      .run(winAmount, user.id);
    
    db.prepare('UPDATE daily_scores SET score = score + ?, wins = wins + 1 WHERE tg_id = ? AND date = ?')
      .run(winAmount, user.id, today);

    const updatedUser = db.prepare('SELECT balance FROM users WHERE tg_id = ?').get(user.id);
    const updatedScore = db.prepare('SELECT score, wins FROM daily_scores WHERE tg_id = ? AND date = ?').get(user.id, today);

    console.log(`✅ Submit: user ${user.id}, win ${winAmount}`);
    res.json({ balance: updatedUser.balance, score: updatedScore });
  } catch (e) {
    console.error('❌ /api/submit error:', e);
    res.status(500).json({ error: 'Server error: ' + e.message });
  }
});

// 3️⃣ Лидерборд
app.get('/api/leaderboard', (req, res) => {
  try {
    const today = getTodayUTC();
    const top = db.prepare(`
      SELECT u.username, ds.score, ds.wins
      FROM daily_scores ds
      JOIN users u ON ds.tg_id = u.tg_id
      WHERE ds.date = ?
      ORDER BY ds.score DESC
      LIMIT 20
    `).all(today);
    
    console.log(`✅ Leaderboard: ${top.length} players`);
    res.json(top);
  } catch (e) {
    console.error('❌ /api/leaderboard error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// 404 handler
app.use((req, res) => {
  console.warn(`⚠️ 404: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Endpoint not found' });
});

// Глобальная обработка ошибок
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));
