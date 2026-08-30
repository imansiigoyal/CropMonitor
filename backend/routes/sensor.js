// routes/sensor.js — Handles ESP32 sensor data ingestion and retrieval
const express = require('express');
const router = express.Router();
const {
  insertReading,
  getLatestReading,
  getRecentReadings,
} = require('../db');

const MOISTURE_ON  = parseInt(process.env.MOISTURE_ON_THRESHOLD  ?? 30);
const MOISTURE_OFF = parseInt(process.env.MOISTURE_OFF_THRESHOLD ?? 60);

// Global reference to broadcast function (set by server.js)
let broadcastFn = null;
router.setBroadcast = (fn) => { broadcastFn = fn; };

// Shared irrigation state accessible by other routes
const irrigationState = {
  mode: 'auto',    // 'auto' | 'manual'
  pumpOn: false,
};
router.irrigationState = irrigationState;

/**
 * POST /api/sensor
 * ESP32 posts JSON: { moisture, temperature, humidity }
 * Server decides pump state and returns it to ESP32.
 */
router.post('/', (req, res) => {
  const { moisture, temperature, humidity } = req.body;

  if (moisture == null || temperature == null || humidity == null) {
    return res.status(400).json({ error: 'Missing sensor fields' });
  }

  // Signal the demo simulator to stand down — a real device is posting
  if (router.markRealDevice) router.markRealDevice();

  // Auto-irrigation logic (only when mode is 'auto')
  if (irrigationState.mode === 'auto') {
    if (moisture < MOISTURE_ON && !irrigationState.pumpOn) {
      irrigationState.pumpOn = true;
    } else if (moisture >= MOISTURE_OFF && irrigationState.pumpOn) {
      irrigationState.pumpOn = false;
    }
  }

  const pump_state = irrigationState.pumpOn ? 1 : 0;

  // Persist reading
  insertReading({ moisture, temperature, humidity, pump_state });

  // Build payload for WebSocket broadcast
  const payload = {
    type: 'sensor_update',
    data: {
      moisture: parseFloat(moisture),
      temperature: parseFloat(temperature),
      humidity: parseFloat(humidity),
      pump_on: irrigationState.pumpOn,
      mode: irrigationState.mode,
      moisture_on_threshold: MOISTURE_ON,
      moisture_off_threshold: MOISTURE_OFF,
      timestamp: new Date().toISOString(),
    },
  };

  if (broadcastFn) broadcastFn(JSON.stringify(payload));

  // Tell ESP32 whether to run the pump
  return res.json({ pump_on: irrigationState.pumpOn });
});

/**
 * GET /api/sensor/latest
 * Returns the most recent sensor reading from DB.
 */
router.get('/latest', (req, res) => {
  const row = getLatestReading();
  if (!row) return res.json(null);

  res.json({
    ...row,
    pump_on: row.pump_state === 1,
    mode: irrigationState.mode,
    moisture_on_threshold: MOISTURE_ON,
    moisture_off_threshold: MOISTURE_OFF,
  });
});

/**
 * GET /api/sensor/history
 * Returns last 24 hours of readings for charts.
 */
router.get('/history', (req, res) => {
  const rows = getRecentReadings();
  res.json(rows);
});

// ── Demo / Simulator ─────────────────────────────────────────────────────
// When DEMO_MODE=true (default), auto-generates realistic sensor readings
// whenever no real ESP32 has posted data in the last 60 seconds.
// This keeps the hosted dashboard always looking live.
// Set DEMO_MODE=false in Render environment variables to disable.

const DEMO_ENABLED = process.env.DEMO_MODE !== 'false';

if (DEMO_ENABLED) {
  let demoMoisture   = 55;
  let demoTemp       = 26;
  let demoHumidity   = 68;
  let lastRealPostMs = 0;

  // Call this from the POST handler when a real device connects
  router.markRealDevice = () => { lastRealPostMs = Date.now(); };

  // Tick every 8 seconds — stands down if a real ESP32 is posting
  setInterval(() => {
    if (Date.now() - lastRealPostMs < 60_000) return;

    demoMoisture  = clamp(demoMoisture  + rnd(-1.5, 1.5), 10, 95);
    demoTemp      = clamp(demoTemp      + rnd(-0.3, 0.3),  18, 40);
    demoHumidity  = clamp(demoHumidity  + rnd(-0.8, 0.8),  30, 95);

    if (irrigationState.mode === 'auto') {
      if (demoMoisture < MOISTURE_ON  && !irrigationState.pumpOn) irrigationState.pumpOn = true;
      if (demoMoisture >= MOISTURE_OFF && irrigationState.pumpOn)  irrigationState.pumpOn = false;
    }

    const pump_state = irrigationState.pumpOn ? 1 : 0;
    insertReading({
      moisture:    demoMoisture,
      temperature: demoTemp,
      humidity:    demoHumidity,
      pump_state,
    });

    const payload = {
      type: 'sensor_update',
      data: {
        moisture:               parseFloat(demoMoisture.toFixed(1)),
        temperature:            parseFloat(demoTemp.toFixed(1)),
        humidity:               parseFloat(demoHumidity.toFixed(1)),
        pump_on:                irrigationState.pumpOn,
        mode:                   irrigationState.mode,
        moisture_on_threshold:  MOISTURE_ON,
        moisture_off_threshold: MOISTURE_OFF,
        timestamp:              new Date().toISOString(),
        demo:                   true,
      },
    };
    if (broadcastFn) broadcastFn(JSON.stringify(payload));
  }, 8_000);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rnd(lo, hi)       { return lo + Math.random() * (hi - lo); }

module.exports = router;
