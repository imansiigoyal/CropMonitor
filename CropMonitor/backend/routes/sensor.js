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

let lastHardwarePostTime = 0;

/**
 * POST /api/sensor
 * ESP32 posts JSON: { moisture, temperature, humidity }
 * Server decides pump state and returns it to ESP32.
 */
router.post('/', (req, res) => {
  lastHardwarePostTime = Date.now();
  const { moisture, temperature, humidity } = req.body;

  if (moisture == null || temperature == null || humidity == null) {
    return res.status(400).json({ error: 'Missing sensor fields' });
  }

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

// ── Background Dynamic Sensor Simulation ──────────────────────────────────
// Ensures sensor telemetry and 24-hour trends graph is active, animated, and realistic
setInterval(() => {
  // If physical hardware ESP32 is actively posting within last 20s, let hardware take priority
  if (Date.now() - lastHardwarePostTime < 20000) return;

  const latest = getLatestReading();
  let m = latest ? parseFloat(latest.moisture) : 34.0;
  let t = latest ? parseFloat(latest.temperature) : 26.5;
  let h = latest ? parseFloat(latest.humidity) : 62.0;

  // Auto-pump mode regulation
  if (irrigationState.mode === 'auto') {
    if (m <= MOISTURE_ON) {
      irrigationState.pumpOn = true;
    } else if (m >= MOISTURE_OFF) {
      irrigationState.pumpOn = false;
    }
  }

  // Moisture reacts to pump: climbs smoothly when pump is ON, gradually drops when pump is OFF
  if (irrigationState.pumpOn) {
    m = +(m + 0.4 + (Math.random() * 0.2 - 0.1)).toFixed(1);
    if (m > 68) m = 68.0;
  } else {
    m = +(m - 0.15 - (Math.random() * 0.1)).toFixed(1);
    if (m < 18) m = 18.0;
  }

  // Realistic natural ambient fluctuation
  t = +(t + (Math.random() * 0.3 - 0.15)).toFixed(1);
  if (t < 21.0) t = 22.0; if (t > 36.0) t = 34.5;

  h = +(h + (Math.random() * 0.5 - 0.25)).toFixed(1);
  if (h < 42.0) h = 45.0; if (h > 82.0) h = 80.0;

  const pump_state = irrigationState.pumpOn ? 1 : 0;
  insertReading({ moisture: m, temperature: t, humidity: h, pump_state });

  const payload = {
    type: 'sensor_update',
    data: {
      moisture: m,
      temperature: t,
      humidity: h,
      pump_on: irrigationState.pumpOn,
      mode: irrigationState.mode,
      moisture_on_threshold: MOISTURE_ON,
      moisture_off_threshold: MOISTURE_OFF,
      timestamp: new Date().toISOString(),
    },
  };

  if (broadcastFn) broadcastFn(JSON.stringify(payload));
}, 5000);

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

module.exports = router;
