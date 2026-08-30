"""
CropMonitor AI — SQLite Database Layer (Python)
Thread-safe operations for sensor readings, AI analyses, and irrigation overrides.
"""
from __future__ import annotations
import os
import sqlite3
import threading

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cropmonitor.db")
_lock   = threading.Lock()

SCHEMA = """
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
"""

# ── Connection ────────────────────────────────────────────────────────────────

def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c

def init_db() -> None:
    """Create tables if they don't exist. Call once at startup."""
    with _lock:
        conn = _conn()
        conn.executescript(SCHEMA)
        conn.commit()
        conn.close()

# ── Sensor Readings ───────────────────────────────────────────────────────────

def insert_reading(moisture: float, temperature: float, humidity: float, pump_state: int) -> None:
    with _lock:
        conn = _conn()
        conn.execute(
            "INSERT INTO sensor_readings (moisture, temperature, humidity, pump_state) VALUES (?,?,?,?)",
            (moisture, temperature, humidity, pump_state),
        )
        conn.commit()
        conn.close()

def get_latest_reading() -> dict | None:
    conn = _conn()
    row = conn.execute(
        "SELECT * FROM sensor_readings ORDER BY id DESC LIMIT 1"
    ).fetchone()
    conn.close()
    return dict(row) if row else None

def get_recent_readings() -> list[dict]:
    conn = _conn()
    rows = conn.execute(
        "SELECT * FROM sensor_readings "
        "WHERE timestamp >= datetime('now', '-24 hours', 'localtime') "
        "ORDER BY timestamp ASC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ── AI Analyses ───────────────────────────────────────────────────────────────

def insert_analysis(image_name: str, overall_health: str, result_json: str) -> None:
    with _lock:
        conn = _conn()
        conn.execute(
            "INSERT INTO ai_analyses (image_name, overall_health, result_json) VALUES (?,?,?)",
            (image_name, overall_health, result_json),
        )
        conn.commit()
        conn.close()

def get_recent_analyses() -> list[dict]:
    conn = _conn()
    rows = conn.execute(
        "SELECT * FROM ai_analyses ORDER BY id DESC LIMIT 10"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ── Irrigation Overrides ──────────────────────────────────────────────────────

def insert_override(mode: str, pump_state: int) -> None:
    with _lock:
        conn = _conn()
        conn.execute(
            "INSERT INTO irrigation_overrides (mode, pump_state) VALUES (?,?)",
            (mode, pump_state),
        )
        conn.commit()
        conn.close()
