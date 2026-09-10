// routes/analyze.js — AI crop image analysis using Google Gemini Vision
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { insertAnalysis, getRecentAnalyses } = require('../db');

// ── Upload directory ─────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Multer (v1 lts) — 25 MB limit ───────────────────────────
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `crop_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    /^image\//.test(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Only image files are accepted'));
  },
});

// ── Model fallback list (flash/lite only — free tier safe) ───
// Order: fastest working → most available
const MODELS = [
  'gemini-3.5-flash-lite',      // ✅ confirmed working
  'gemini-3.1-flash-lite',      // lightweight fallback
  'gemini-flash-lite-latest',   // alias fallback
  'gemini-3.1-flash-lite-preview',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
];

// ── Compact prompt (fewer tokens = less quota usage) ─────────
const PROMPT = `You are an expert plant pathologist. Analyse this crop image.
Return ONLY a JSON object with no markdown or extra text:
{
  "overall_health": "Good|Fair|Poor|Critical",
  "health_score": <0-100>,
  "diseases": [{"name":"...","confidence":"High|Medium|Low","affected_area":"...","treatment":"..."}],
  "pests": [{"name":"...","risk_level":"High|Medium|Low","signs":"...","control":"..."}],
  "nutrient_deficiency": [{"type":"...","symptoms":"...","remedy":"..."}],
  "recommendations": ["..."],
  "urgency": "Immediate|Within a week|Routine monitoring"
}
Use [] for empty categories. Base everything only on what is visible.`;

// ── Helper: parse retry-after seconds from error message ─────
function parseRetryAfter(msg) {
  const m = msg?.match(/retry in (\d+(\.\d+)?)s/i);
  return m ? Math.ceil(parseFloat(m[1])) * 1000 : 2000;
}

// ── Helper: call one model ───────────────────────────────────
async function callModel(modelName, apiKey, mimeType, base64Image) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });
  return model.generateContent([
    { text: PROMPT },
    { inlineData: { mimeType, data: base64Image } },
  ]);
}

// ── POST /api/analyze ────────────────────────────────────────
router.post('/', (req, res) => {
  upload.single('image')(req, res, async (multerErr) => {

    if (multerErr) {
      const msg = multerErr.code === 'LIMIT_FILE_SIZE'
        ? 'Image too large. Please use a photo under 25 MB.'
        : multerErr.message;
      return res.status(400).json({ error: msg });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      safeDelete(req.file.path);
      return res.status(503).json({ error: 'Gemini API key not configured in .env file.' });
    }

    let imageBuffer, base64Image, mimeType;
    try {
      imageBuffer  = fs.readFileSync(req.file.path);
      base64Image  = imageBuffer.toString('base64');
      mimeType     = req.file.mimetype || 'image/jpeg';
    } catch (readErr) {
      return res.status(500).json({ error: 'Could not read uploaded file.' });
    }

    // ── Try each model in order ──────────────────────────────
    let lastError = null;

    for (const modelName of MODELS) {
      try {
        console.log(`[Gemini] Trying: ${modelName}`);
        const result  = await callModel(modelName, apiKey, mimeType, base64Image);
        const rawText = result.response.text().trim();
        console.log(`[Gemini] ✅ ${modelName} responded. Raw[0:150]: ${rawText.slice(0, 150)}`);

        // Strip markdown fences if present
        const jsonStr = rawText
          .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

        let analysis;
        try {
          analysis = JSON.parse(jsonStr);
        } catch {
          console.error('[Gemini] JSON parse failed. Raw:', rawText.slice(0, 300));
          safeDelete(req.file.path);
          return res.status(500).json({ error: 'AI returned an unreadable response. Please try again.' });
        }

        // Persist result
        insertAnalysis({
          image_name:     req.file.originalname || req.file.filename,
          overall_health: analysis.overall_health ?? 'Unknown',
          result_json:    JSON.stringify(analysis),
        });

        safeDelete(req.file.path);
        return res.json(analysis);

      } catch (err) {
        lastError = err;
        const msg  = err.message ?? '';
        const is503 = msg.includes('503') || msg.includes('Service Unavailable') || msg.includes('overload');
        const is429 = msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('quota');
        const is404 = msg.includes('404') || msg.includes('not found') || msg.includes('no longer available');

        console.warn(`[Gemini] ${modelName} failed: ${is503?'503':is429?'429':is404?'404':'ERR'} — ${msg.slice(0,100)}`);

        if (is503 || is404) {
          // Overloaded or missing — try next model after short wait
          await sleep(1500);
          continue;
        }

        if (is429) {
          // Quota — wait for retry-after then try next model
          const waitMs = parseRetryAfter(msg);
          console.log(`[Gemini] Quota hit on ${modelName}, waiting ${Math.round(waitMs/1000)}s then trying next model…`);
          await sleep(Math.min(waitMs, 8000)); // cap at 8s per model
          continue;
        }

        // Auth / unknown error — stop immediately
        break;
      }
    }

    // All models failed
    safeDelete(req.file.path);
    const finalMsg = lastError?.message?.includes('quota') || lastError?.message?.includes('429')
      ? 'All AI models are currently at quota limit. Please wait 1–2 minutes and try again.'
      : `Analysis failed: ${lastError?.message ?? 'Unknown error'}`;

    return res.status(503).json({ error: finalMsg });
  });
});

// ── GET /api/analyze/history ─────────────────────────────────
router.get('/history', (req, res) => {
  try {
    const rows = getRecentAnalyses();
    return res.json(rows.map(r => ({ ...r, result: JSON.parse(r.result_json) })));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Helpers ───────────────────────────────────────────────────
function safeDelete(p) { if (p) fs.unlink(p, () => {}); }
function sleep(ms)     { return new Promise(r => setTimeout(r, ms)); }

module.exports = router;
