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

module.exports = router;
