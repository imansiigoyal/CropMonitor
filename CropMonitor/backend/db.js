// db.js — Pure-JS SQLite database using sql.js (no native build required)
const path = require('path');
const fs   = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'cropmonitor.db');

let db  = null;    // sql.js Database instance
let SQL = null;    // sql.js class

/** Persist in-memory DB to disk */
function saveToDisk() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/** Auto-save every 10 seconds so we don't lose recent data */
setInterval(saveToDisk, 10_000);

// ── Schema ────────────────────────────────────────────────────────────────
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sensor_readings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT DEFAULT (datetime('now','localtime')),
    moisture    REAL NOT NULL,
    temperature REAL NOT NULL,
    humidity    REAL NOT NULL,
    pump_state  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ai_analyses (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT DEFAULT (datetime('now','localtime')),
    image_name      TEXT,
    overall_health  TEXT,
    result_json     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS irrigation_overrides (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT DEFAULT (datetime('now','localtime')),
    mode        TEXT NOT NULL,
    pump_state  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT DEFAULT (datetime('now','localtime')),
    role        TEXT NOT NULL,
    content     TEXT NOT NULL
  );
`;

/** Initialise the database. Must be awaited before server starts. */
async function initDB() {
  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(SCHEMA);
  seedHistoryIfEmpty();
  saveToDisk();
  return db;
}

/** Seed realistic 24-hour historical sensor telemetry if database is empty or sparse */
function seedHistoryIfEmpty() {
  const row = queryOne(`SELECT COUNT(*) as cnt FROM sensor_readings`);
  if (!row || row.cnt < 12) {
    console.log('  🌱 Seeding realistic 24-hour sensor trends history...');
    const now = Date.now();
    for (let i = 24; i >= 0; i--) {
      const past = new Date(now - i * 3600 * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      const ts = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())} ${pad(past.getHours())}:${pad(past.getMinutes())}:${pad(past.getSeconds())}`;
      
      const hr = past.getHours();
      // Natural diurnal solar temperature cycle
      const sunFactor = Math.sin(((hr - 6) / 24) * 2 * Math.PI);
      const temp = +(26.0 + sunFactor * 5.0 + ((i % 3) * 0.4 - 0.6)).toFixed(1);
      const hum = +(62.0 - sunFactor * 12.0 + ((i % 4) * 0.7 - 1.0)).toFixed(1);
      // Realistic soil moisture variation (32% to 48%)
      const moist = +(38.0 + Math.sin(i * 0.45) * 8.5 + ((i % 5) * 0.5 - 1.0)).toFixed(1);
      const pump = moist < 30 ? 1 : 0;

      run(
        `INSERT INTO sensor_readings (timestamp, moisture, temperature, humidity, pump_state)
         VALUES (:ts, :moisture, :temperature, :humidity, :pump_state)`,
        { ':ts': ts, ':moisture': moist, ':temperature': temp, ':humidity': hum, ':pump_state': pump }
      );
    }
    saveToDisk();
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function run(sql, params = {}) {
  db.run(sql, params);
  saveToDisk();
}

function queryAll(sql, params = {}) {
  const stmt    = db.prepare(sql);
  const results = [];
  stmt.bind(params);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = {}) {
  const rows = queryAll(sql, params);
  return rows[0] ?? null;
}

// ── Sensor ────────────────────────────────────────────────────────────────
function insertReading({ moisture, temperature, humidity, pump_state }) {
  run(
    `INSERT INTO sensor_readings (moisture, temperature, humidity, pump_state)
     VALUES (:moisture, :temperature, :humidity, :pump_state)`,
    { ':moisture': moisture, ':temperature': temperature, ':humidity': humidity, ':pump_state': pump_state }
  );
}

function getLatestReading() {
  return queryOne(`SELECT * FROM sensor_readings ORDER BY id DESC LIMIT 1`);
}

function getRecentReadings() {
  let rows = queryAll(
    `SELECT * FROM sensor_readings
     WHERE timestamp >= datetime('now', '-24 hours', 'localtime')
     ORDER BY timestamp ASC`
  );
  if (!rows || rows.length < 6) {
    // Fallback: fetch last 30 readings and return in chronological order
    rows = queryAll(
      `SELECT * FROM sensor_readings
       ORDER BY id DESC LIMIT 30`
    );
    rows.reverse();
  }
  return rows;
}

// ── AI Analysis ───────────────────────────────────────────────────────────
function insertAnalysis({ image_name, overall_health, result_json }) {
  run(
    `INSERT INTO ai_analyses (image_name, overall_health, result_json)
     VALUES (:image_name, :overall_health, :result_json)`,
    { ':image_name': image_name, ':overall_health': overall_health, ':result_json': result_json }
  );
}

function getRecentAnalyses() {
  return queryAll(`SELECT * FROM ai_analyses ORDER BY id DESC LIMIT 10`);
}

// ── Irrigation ────────────────────────────────────────────────────────────
function insertOverride({ mode, pump_state }) {
  run(
    `INSERT INTO irrigation_overrides (mode, pump_state) VALUES (:mode, :pump_state)`,
    { ':mode': mode, ':pump_state': pump_state }
  );
}

function getLatestOverride() {
  return queryOne(`SELECT * FROM irrigation_overrides ORDER BY id DESC LIMIT 1`);
}

// ── Chat ──────────────────────────────────────────────────────────────────
function insertChatMessage({ role, content }) {
  run(
    `INSERT INTO chat_messages (role, content) VALUES (:role, :content)`,
    { ':role': role, ':content': content }
  );
}

function getRecentChatMessages(limit = 30) {
  const rows = queryAll(
    `SELECT * FROM chat_messages ORDER BY id DESC LIMIT :limit`,
    { ':limit': limit }
  );
  return rows.reverse();
}

function clearChatHistory() {
  run(`DELETE FROM chat_messages`);
}

module.exports = {
  initDB,
  insertReading,
  getLatestReading,
  getRecentReadings,
  insertAnalysis,
  getRecentAnalyses,
  insertOverride,
  getLatestOverride,
  insertChatMessage,
  getRecentChatMessages,
  clearChatHistory,
};

