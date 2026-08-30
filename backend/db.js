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
  saveToDisk();
  return db;
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
  return queryAll(
    `SELECT * FROM sensor_readings
     WHERE timestamp >= datetime('now', '-24 hours', 'localtime')
     ORDER BY timestamp ASC`
  );
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

module.exports = {
  initDB,
  insertReading,
  getLatestReading,
  getRecentReadings,
  insertAnalysis,
  getRecentAnalyses,
  insertOverride,
  getLatestOverride,
};
