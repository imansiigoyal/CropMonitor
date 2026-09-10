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

// ── Enriched Agronomy & Crop-Specific Analysis Prompt ───────
const PROMPT = `You are an expert agricultural scientist, botanist, and plant pathologist.
Analyze this crop image thoroughly. Identify the specific crop, its growth stage, and assess its overall health.
Even if the crop is healthy with no active infection, provide crop-specific analysis, preventive disease/pest watches, nutrient advice, and care recommendations tailored specifically to this plant.

Return ONLY a valid JSON object with NO markdown code fences or extra text:
{
  "crop_name": "Identified crop name (e.g. Wheat, Tomato, Rice, Green Bean, Corn, Cotton, etc.)",
  "scientific_name": "Botanical / scientific name",
  "growth_stage": "Growth stage (e.g. Vegetative, Flowering, Grain Filling, Ripening, Fruiting)",
  "overall_health": "Good, Fair, Poor, or Critical",
  "health_score": <number 0-100>,
  "visual_assessment": "Detailed 2-3 sentence assessment of leaf color, canopy density, vigor, and visible conditions",
  "diseases": [
    {
      "name": "Disease name",
      "status": "Active Infection or Preventive Watch",
      "confidence": "High, Medium, or Low",
      "affected_area": "Leaves, Stems, Ears/Heads, or Fruit",
      "treatment": "Practical organic and chemical treatment advice"
    }
  ],
  "pests": [
    {
      "name": "Pest name",
      "status": "Active Infestation or Common Threat Watch",
      "risk_level": "High, Medium, or Low",
      "signs": "Symptoms or indicators to inspect",
      "control": "Control measures and spray guidance"
    }
  ],
  "nutrient_deficiency": [
    {
      "type": "Specific nutrient (e.g. Nitrogen, Zinc, Potassium) or 'Optimal Balance'",
      "symptoms": "Visible signs or stage requirements for this crop",
      "remedy": "Recommended fertilizer and soil amendment"
    }
  ],
  "soil_irrigation_guide": "Specific irrigation and soil care recommendations for this crop at this stage",
  "recommendations": [
    "Actionable crop recommendation 1",
    "Actionable crop recommendation 2",
    "Actionable crop recommendation 3"
  ],
  "urgency": "Immediate, Within a week, or Routine monitoring"
}
Do NOT return empty disease or pest lists. If the crop is healthy with no visible infection, include the top 2-3 common diseases and pests that affect this specific crop at this growth stage under 'Preventive Watch' status so the grower has proactive crop care instructions!`;

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
