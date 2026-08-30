"""
CropMonitor AI — FastAPI Background Server
Handles all ESP32-facing API endpoints.
Runs in a daemon thread inside the Streamlit process on port 8502.

The irrigation_state dict is shared directly with app.py (same process/memory).
"""
from __future__ import annotations
import os
import io
import json
import time
import random
import threading
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import database as db

# ── FastAPI app ───────────────────────────────────────────────────────────────
fastapi_app = FastAPI(title="CropMonitor ESP32 API", version="1.0.0")
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Shared irrigation state (accessed by both FastAPI and Streamlit) ──────────
_state_lock = threading.Lock()
_irrigation: dict = {"mode": "auto", "pump_on": False}

MOISTURE_ON  = int(os.getenv("MOISTURE_ON_THRESHOLD",  "30"))
MOISTURE_OFF = int(os.getenv("MOISTURE_OFF_THRESHOLD", "60"))


def get_state() -> dict:
    """Return a copy of the current irrigation state."""
    with _state_lock:
        return dict(_irrigation)


def set_state(mode: str | None = None, pump_on: bool | None = None) -> dict:
    """Update irrigation state atomically. Returns the new state."""
    with _state_lock:
        if mode     is not None: _irrigation["mode"]    = mode
        if pump_on  is not None: _irrigation["pump_on"] = pump_on
        return dict(_irrigation)


# ── Demo simulator ────────────────────────────────────────────────────────────
_last_real_post: float = 0.0  # epoch seconds — updated when a real ESP32 POSTs


def _mark_real_device() -> None:
    global _last_real_post
    _last_real_post = time.time()


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _demo_loop() -> None:
    """Background thread: generate realistic sensor readings when no ESP32 is active."""
    moisture = 55.0
    temp     = 26.0
    humidity = 68.0

    while True:
        time.sleep(8)
        if time.time() - _last_real_post < 60:
            continue  # real device is posting — stand down

        moisture = _clamp(moisture + random.uniform(-1.5, 1.5), 10, 95)
        temp     = _clamp(temp     + random.uniform(-0.3, 0.3), 18, 40)
        humidity = _clamp(humidity + random.uniform(-0.8, 0.8), 30, 95)

        state = get_state()
        if state["mode"] == "auto":
            if moisture < MOISTURE_ON  and not state["pump_on"]: set_state(pump_on=True)
            if moisture >= MOISTURE_OFF and state["pump_on"]:     set_state(pump_on=False)

        state = get_state()
        db.insert_reading(
            round(moisture, 1),
            round(temp, 1),
            round(humidity, 1),
            int(state["pump_on"]),
        )


def start_demo_simulator() -> None:
    t = threading.Thread(target=_demo_loop, daemon=True, name="demo-simulator")
    t.start()


# ── Sensor endpoints ──────────────────────────────────────────────────────────

class SensorPayload(BaseModel):
    moisture:    float
    temperature: float
    humidity:    float


@fastapi_app.post("/api/sensor")
def post_sensor(payload: SensorPayload):
    """ESP32 posts {moisture, temperature, humidity} here."""
    _mark_real_device()

    state = get_state()
    if state["mode"] == "auto":
        if payload.moisture < MOISTURE_ON  and not state["pump_on"]: set_state(pump_on=True)
        if payload.moisture >= MOISTURE_OFF and state["pump_on"]:     set_state(pump_on=False)

    state = get_state()
    db.insert_reading(payload.moisture, payload.temperature, payload.humidity, int(state["pump_on"]))
    return {"pump_on": state["pump_on"]}


@fastapi_app.get("/api/sensor/latest")
def get_latest():
    row = db.get_latest_reading()
    if not row:
        return None
    state = get_state()
    return {
        **row,
        "pump_on": bool(row.get("pump_state", 0)),
        "mode":    state["mode"],
        "moisture_on_threshold":  MOISTURE_ON,
        "moisture_off_threshold": MOISTURE_OFF,
    }


@fastapi_app.get("/api/sensor/history")
def get_history():
    return db.get_recent_readings()


# ── Irrigation endpoints ──────────────────────────────────────────────────────

class IrrigationOverride(BaseModel):
    mode:    str
    pump_on: bool = False


@fastapi_app.post("/api/irrigation/override")
def override_irrigation(payload: IrrigationOverride):
    if payload.mode not in ("auto", "manual"):
        raise HTTPException(400, "mode must be 'auto' or 'manual'")
    new_pump = payload.pump_on if payload.mode == "manual" else get_state()["pump_on"]
    state = set_state(mode=payload.mode, pump_on=new_pump)
    db.insert_override(payload.mode, int(state["pump_on"]))
    return {"success": True, "mode": state["mode"], "pump_on": state["pump_on"]}


@fastapi_app.get("/api/irrigation/status")
def irrigation_status():
    return get_state()


# ── AI Analysis endpoints ─────────────────────────────────────────────────────

GEMINI_MODELS = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-pro-preview",
    "gemini-flash-latest",
]

ANALYSIS_PROMPT = """You are an expert plant pathologist and agronomist. Analyse this crop image thoroughly.

IMPORTANT RULES:
- Always populate ALL fields, even for healthy plants
- For healthy plants: list common risks for this crop type and growth stage as "Low" risk items
- For pests: always list at least 2 common pests that affect this type of plant (even if not currently visible), with risk_level "Low" if not detected
- For nutrient_deficiency: always assess and list common deficiencies for this crop (e.g., Nitrogen, Iron, Magnesium), even if mild or at risk

Return ONLY a valid JSON object, no markdown, no extra text:
{
  "overall_health": "Good|Fair|Poor|Critical",
  "health_score": <integer 0-100>,
  "diseases": [{"name":"...","confidence":"High|Medium|Low","affected_area":"...","treatment":"..."}],
  "pests": [{"name":"...","risk_level":"High|Medium|Low","signs":"...","control":"..."}],
  "nutrient_deficiency": [{"type":"...","symptoms":"...","remedy":"..."}],
  "recommendations": ["at least 3 specific actionable recommendations"],
  "urgency": "Immediate|Within a week|Routine monitoring"
}"""


@fastapi_app.post("/api/analyze")
async def analyze_crop(image: UploadFile = File(...)):
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key or api_key == "your_gemini_api_key_here":
        raise HTTPException(503, "Gemini API key not configured.")

    image_bytes = await image.read()

    try:
        import PIL.Image
        import google.generativeai as genai

        pil_img = PIL.Image.open(io.BytesIO(image_bytes))
        genai.configure(api_key=api_key)
    except Exception as e:
        raise HTTPException(500, f"Setup error: {e}")

    last_err: Exception | None = None
    for model_name in GEMINI_MODELS:
        try:
            model = genai.GenerativeModel(model_name)
            response = model.generate_content([ANALYSIS_PROMPT, pil_img])
            raw = response.text.strip()
            raw = raw.replace("```json", "").replace("```", "").strip()
            analysis = json.loads(raw)
            db.insert_analysis(
                image.filename or "upload",
                analysis.get("overall_health", "Unknown"),
                json.dumps(analysis),
            )
            return analysis
        except Exception as e:
            last_err = e
            time.sleep(1.5)
            continue

    raise HTTPException(503, f"All models failed: {last_err}")


@fastapi_app.get("/api/analyze/history")
def get_analyses():
    rows = db.get_recent_analyses()
    return [
        {
            "id":            r["id"],
            "timestamp":     r["timestamp"],
            "image_name":    r["image_name"],
            "overall_health":r["overall_health"],
            "result":        json.loads(r["result_json"]),
        }
        for r in rows
    ]


@fastapi_app.get("/api/ping")
def ping():
    return {"status": "ok", "ts": time.time()}
