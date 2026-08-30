// server.js — Main entry point for CropMonitor backend
require('dotenv').config();

const express    = require('express');
const http       = require('http');
const path       = require('path');
const cors       = require('cors');
const { WebSocketServer } = require('ws');

const sensorRouter     = require('./routes/sensor');
const analyzeRouter    = require('./routes/analyze');
const irrigationRouter = require('./routes/irrigation');
const { initDB }       = require('./db');

const PORT = process.env.PORT || 3000;

// ── Express app ──────────────────────────────────────────────────────────
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the frontend dashboard as static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ── API routes ───────────────────────────────────────────────────────────
app.use('/api/sensor',     sensorRouter);
app.use('/api/analyze',    analyzeRouter);
app.use('/api/irrigation', irrigationRouter);

// Health check
app.get('/api/ping', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Fallback — serve index.html for all non-API routes (SPA support)
app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ── Global error handler — always return JSON for /api routes ─────────────
// This prevents "unexpected token <" errors on the frontend
app.use((err, req, res, _next) => {
  console.error('[Express error]', err.message);
  if (req.path.startsWith('/api')) {
    return res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
  res.status(500).send('Server error');
});

// ── HTTP + WebSocket server ───────────────────────────────────────────────
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/ws' });

/** Broadcast a message to all connected WebSocket clients */
function broadcast(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[WS] Client connected: ${ip}`);

  ws.on('close', () => console.log(`[WS] Client disconnected: ${ip}`));
  ws.on('error', (err) => console.error('[WS] Error:', err));
});

// ── Wire up shared state between routes ─────────────────────────────────
sensorRouter.setBroadcast(broadcast);
irrigationRouter.setIrrigationState(sensorRouter.irrigationState);
irrigationRouter.setBroadcast(broadcast);

// ── Start ────────────────────────────────────────────────────────────────
async function start() {
  await initDB();
  console.log('  🗄️   Database initialised');

  server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  🌱  CropMonitor Backend is running');
  console.log(`  📡  REST API  →  http://localhost:${PORT}/api`);
  console.log(`  🖥️   Dashboard →  http://localhost:${PORT}`);
  console.log(`  🔌  WebSocket →  ws://localhost:${PORT}/ws`);
  console.log('');
  console.log(`  Irrigation thresholds:`);
  console.log(`    Pump ON  when moisture < ${process.env.MOISTURE_ON_THRESHOLD  ?? 30}%`);
  console.log(`    Pump OFF when moisture > ${process.env.MOISTURE_OFF_THRESHOLD ?? 60}%`);
    console.log('');
  });
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
