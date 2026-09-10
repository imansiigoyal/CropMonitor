// routes/chat.js — AI Agronomy Chatbot (AgriBot) powered by Google Gemini
const express = require('express');
const router  = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  getLatestReading,
  getLatestOverride,
  getRecentAnalyses,
  insertChatMessage,
  getRecentChatMessages,
  clearChatHistory,
} = require('../db');

// ── Model fallback list (Flash/Lite free-tier safe) ───────────
const MODELS = [
  'gemini-3.5-flash-lite',      // primary & fast
  'gemini-3.6-flash',           // current stable flash
  'gemini-3.1-flash-lite',      // lightweight fallback
  'gemini-flash-lite-latest',   // alias fallback
  'gemini-3.7-flash',
  'gemini-3.5-flash',
];

// ── Helper: assemble real-time context from DB and environment 
function getSystemContext() {
  const reading   = getLatestReading();
  const override  = getLatestOverride();
  const analyses  = getRecentAnalyses();
  const onThresh  = process.env.MOISTURE_ON_THRESHOLD  ?? 30;
  const offThresh = process.env.MOISTURE_OFF_THRESHOLD ?? 60;

  let sensorContext = 'Sensor data: No sensor readings received yet.';
  if (reading) {
    const isPumpOn = reading.pump_state === 1;
    const mode = override?.mode ?? 'auto';
    sensorContext = `Current Real-Time Farm Telemetry:
- Soil Moisture: ${reading.moisture.toFixed(1)}% (Thresholds: Auto-ON < ${onThresh}%, Auto-OFF > ${offThresh}%)
- Ambient Temperature: ${reading.temperature.toFixed(1)}°C
- Relative Humidity: ${reading.humidity.toFixed(1)}%
- Irrigation Pump: ${isPumpOn ? 'ON 💦' : 'OFF ⛔'} (Mode: ${mode})
- Last Sensor Telemetry Timestamp: ${reading.timestamp}`;
  }

  let analysisContext = 'Crop Disease Diagnosis: No image analysis performed yet.';
  if (analyses && analyses.length > 0) {
    const latest = analyses[0];
    let parsed = null;
    try { parsed = JSON.parse(latest.result_json); } catch {}

    if (parsed) {
      const diseases = (parsed.diseases || []).map(d => `${d.name} (${d.confidence} confidence)`).join(', ') || 'None';
      const pests = (parsed.pests || []).map(p => `${p.name} (${p.risk_level} risk)`).join(', ') || 'None';
      const deficiencies = (parsed.nutrient_deficiency || []).map(n => n.type).join(', ') || 'None';
      const recs = (parsed.recommendations || []).slice(0, 3).join('; ') || 'None';

      analysisContext = `Latest AI Crop Visual Diagnosis (${latest.timestamp}):
- Overall Plant Health: ${parsed.overall_health || 'Unknown'} (Health Score: ${parsed.health_score ?? 'N/A'}/100)
- Urgency Level: ${parsed.urgency || 'Routine'}
- Detected Diseases: ${diseases}
- Detected Pests: ${pests}
- Nutrient Deficiencies: ${deficiencies}
- Key Recommendations: ${recs}`;
    }
  }

  return `You are "AgriBot AI", an expert agricultural consultant, plant pathologist, and smart irrigation assistant embedded in CropMonitor AI.
You help farmers, greenhouse managers, and home gardeners optimize crop yields, identify and treat plant diseases, manage soil health, and make informed irrigation decisions.

CURRENT LIVE FARM CONTEXT:
----------------------------------------
${sensorContext}
----------------------------------------
${analysisContext}
----------------------------------------

GUIDELINES:
1. When asked about current farm conditions (soil moisture, temperature, humidity, pump, crop status), directly cite and interpret the real-time farm data above.
2. If soil moisture is low (< ${onThresh}%), actively advise irrigation or check if pump is running. If temperature is very high (> 35°C), advise heat-stress mitigation measures (shading, misting, mulching).
3. If asked about pests, plant diseases, fertilizers, or cultivation techniques, provide practical, accurate, step-by-step advice (including organic and conventional remedies, soil amendment, and watering frequency).
4. Keep answers friendly, structured, concise, and easy to read. Use bullet points and bold highlights where appropriate.
5. If the user greets you or asks who you are, introduce yourself as AgriBot AI and briefly mention that you can monitor their live sensor telemetry and answer any farming questions.`;
}

// ── Call Gemini with model fallbacks ──────────────────────────
async function generateBotReply(apiKey, messagesHistory, userPrompt) {
  const systemInstruction = getSystemContext();
  const genAI = new GoogleGenerativeAI(apiKey);

  let lastErr = null;

  for (const modelName of MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: {
          role: 'system',
          parts: [{ text: systemInstruction }],
        },
      });

      // Prepare conversation history (must start with 'user')
      const formattedHistory = [];
      if (Array.isArray(messagesHistory)) {
        for (const msg of messagesHistory.slice(-10)) { // limit to last 10 messages
          if (msg.role === 'user' || msg.role === 'model') {
            formattedHistory.push({
              role: msg.role === 'model' ? 'model' : 'user',
              parts: [{ text: msg.content || msg.text || '' }],
            });
          }
        }
      }
      // Gemini startChat requires the first history message to be from 'user'
      while (formattedHistory.length > 0 && formattedHistory[0].role !== 'user') {
        formattedHistory.shift();
      }

      const chat = model.startChat({
        history: formattedHistory,
      });

      const result = await chat.sendMessage(userPrompt);
      const reply = result.response.text().trim();
      return reply;

    } catch (err) {
      lastErr = err;
      const msg = err.message || '';
      console.warn(`[AgriBot] Model ${modelName} failed: ${msg.slice(0, 100)}`);

      // If 404/503/429 continue to fallback model
      if (msg.includes('404') || msg.includes('503') || msg.includes('429') || msg.includes('quota') || msg.includes('overload')) {
        continue;
      }
      // If critical error like invalid API key, break early
      if (msg.includes('API_KEY_INVALID') || msg.includes('expired')) {
        break;
      }
    }
  }

  throw lastErr || new Error('All AI models unavailable. Please try again shortly.');
}

// ── POST /api/chat ────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { message, history } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_actual_key_here' || apiKey === 'your_gemini_api_key_here') {
      return res.status(503).json({
        error: 'Gemini API key is not configured in backend/.env.',
      });
    }

    // Persist user message to local SQLite DB
    try {
      insertChatMessage({ role: 'user', content: message.trim() });
    } catch (dbErr) {
      console.warn('[AgriBot DB] Failed to save user message:', dbErr.message);
    }

    // Generate response
    const reply = await generateBotReply(apiKey, history, message.trim());

    // Persist bot reply to DB
    try {
      insertChatMessage({ role: 'model', content: reply });
    } catch (dbErr) {
      console.warn('[AgriBot DB] Failed to save bot reply:', dbErr.message);
    }

    return res.json({
      reply,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[AgriBot Error]', error.message);
    return res.status(500).json({
      error: error.message || 'AgriBot encountered an error while processing your question.',
    });
  }
});

// ── GET /api/chat/history ─────────────────────────────────────
router.get('/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 30;
    const rows = getRecentChatMessages(limit);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/chat/history ──────────────────────────────────
router.delete('/history', (_, res) => {
  try {
    clearChatHistory();
    return res.json({ success: true, message: 'Chat history cleared.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/chat/status ──────────────────────────────────────
router.get('/status', (_, res) => {
  const hasKey = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_actual_key_here';
  res.json({
    online: hasKey,
    name: 'AgriBot AI',
    status: hasKey ? 'ready' : 'api_key_missing',
  });
});

module.exports = router;
