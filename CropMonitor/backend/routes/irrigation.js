// routes/irrigation.js — Manual override for irrigation pump
const express = require('express');
const router  = express.Router();
const { insertOverride } = require('../db');

// irrigationState is injected from sensor route via setIrrigationState
let irrigationState = null;
let broadcastFn     = null;

router.setIrrigationState = (state) => { irrigationState = state; };
router.setBroadcast       = (fn)    => { broadcastFn = fn; };

/**
 * POST /api/irrigation/override
 * Body: { mode: 'auto' | 'manual', pump_on: true | false }
 *
 * - mode 'auto'   → return to automatic threshold-based control
 * - mode 'manual' → force pump on (pump_on: true) or off (pump_on: false)
 */
router.post('/override', (req, res) => {
  if (!irrigationState) {
    return res.status(500).json({ error: 'Server not ready' });
  }

  const { mode, pump_on } = req.body;

  if (!['auto', 'manual'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "auto" or "manual"' });
  }

  irrigationState.mode   = mode;
  irrigationState.pumpOn = mode === 'manual' ? Boolean(pump_on) : irrigationState.pumpOn;

  insertOverride({
    mode,
    pump_state: irrigationState.pumpOn ? 1 : 0,
  });

  const payload = {
    type: 'irrigation_update',
    data: {
      mode:    irrigationState.mode,
      pump_on: irrigationState.pumpOn,
    },
  };
  if (broadcastFn) broadcastFn(JSON.stringify(payload));

  return res.json({
    success: true,
    mode:    irrigationState.mode,
    pump_on: irrigationState.pumpOn,
  });
});

/**
 * GET /api/irrigation/status
 * Returns current irrigation mode and pump state.
 */
router.get('/status', (req, res) => {
  if (!irrigationState) return res.json({ mode: 'auto', pump_on: false });
  res.json({
    mode:    irrigationState.mode,
    pump_on: irrigationState.pumpOn,
  });
});

module.exports = router;
