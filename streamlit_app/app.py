"""
🌿 CropMonitor AI — Streamlit Dashboard
AI-powered smart crop monitoring and automated irrigation system.
"""
from __future__ import annotations
import os, sys, io, json, time, threading
from datetime import datetime

import streamlit as st

# ── Must be the very first Streamlit call ─────────────────────────────────────
st.set_page_config(
    page_title="CropMonitor AI — Smart Farming Dashboard",
    page_icon="🌿",
    layout="wide",
    initial_sidebar_state="collapsed",
    menu_items={"About": "🌿 CropMonitor AI — Smart Farming powered by Gemini Vision"},
)

# ── Path setup ────────────────────────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import database as db

# ── Bootstrap: init DB + start FastAPI + start demo simulator (once per process) ──
@st.cache_resource(show_spinner=False)
def _bootstrap():
    db.init_db()
    try:
        import uvicorn
        from server import fastapi_app, start_demo_simulator

        def _run():
            uvicorn.run(fastapi_app, host="0.0.0.0", port=8502, log_level="error")

        threading.Thread(target=_run, daemon=True, name="fastapi-server").start()
        time.sleep(1.8)   # let uvicorn bind
        start_demo_simulator()
    except Exception as e:
        pass  # non-fatal — dashboard still works for AI analysis
    return True

_bootstrap()

# ── Imports that need the server running ──────────────────────────────────────
from server import get_state, set_state, MOISTURE_ON, MOISTURE_OFF  # type: ignore

# ── Gemini API key helper ─────────────────────────────────────────────────────
def _api_key() -> str:
    key = os.getenv("GEMINI_API_KEY", "")
    if not key:
        try:
            key = st.secrets.get("GEMINI_API_KEY", "")
        except Exception:
            pass
    # Also inject into env so FastAPI server thread can access via os.getenv()
    if key and not os.getenv("GEMINI_API_KEY"):
        os.environ["GEMINI_API_KEY"] = key
    return key or ""

# Inject the key at module load time (before any API call is made)
_api_key()

# ─────────────────────────────────────────────────────────────────────────────
# CUSTOM CSS — Dark glassmorphism theme matching original design
# ─────────────────────────────────────────────────────────────────────────────
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,300;0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;0,14..32,800;0,14..32,900&family=JetBrains+Mono:wght@400;500;600&display=swap');

/* ── Root ── */
.stApp {
    background: #ffffff !important;
    font-family: 'Inter', sans-serif !important;
    min-height: 100vh;
}
.stApp > header { background: #ffffff !important; }
#MainMenu, footer, .stDeployButton, [data-testid="manage-app-button"] { display: none !important; }
.block-container { padding: 1.2rem 2.5rem 4rem !important; max-width: 1380px !important; background: #ffffff; }

/* ── Custom Header ── */
.cm-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 1.4rem 0 1.6rem;
    border-bottom: 2px solid #f0fdf4;
    margin-bottom: 2rem;
}
.cm-logo { display: flex; align-items: center; gap: 1rem; }
.cm-logo-icon { font-size: 2.4rem; }
.cm-logo-title { font-size: 1.65rem; font-weight: 800; color: #0f1f0f; letter-spacing: -0.6px; line-height: 1.1; }
.cm-logo-title span { color: #16a34a; }
.cm-logo-sub { font-size: 0.72rem; color: #6b7280; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 3px; }
.cm-badge {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 0.72rem; font-family: 'JetBrains Mono', monospace; font-weight: 600;
    padding: 6px 14px; border-radius: 50px; letter-spacing: 0.03em;
}
.cm-badge-live  { color: #16a34a; border: 1px solid rgba(22,163,74,0.3); background: #f0fdf4; }
.cm-badge-demo  { color: #d97706; border: 1px solid rgba(217,119,6,0.3); background: #fffbeb; }
.cm-dot { width: 7px; height: 7px; border-radius: 50%; animation: blink 1.6s infinite; }
.cm-dot-live { background: #16a34a; }
.cm-dot-demo { background: #d97706; }
@keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

/* ── Section titles ── */
.sec-title {
    font-size: 0.72rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
    color: #6b7280; margin: 2rem 0 1.1rem;
    display: flex; align-items: center; gap: 0.6rem;
}
.sec-title::after { content: ''; flex: 1; height: 1px; background: #e5e7eb; margin-left: 0.4rem; }

/* ── Sensor cards ── */
.s-card {
    background: #ffffff;
    border: 1.5px solid #e5e7eb;
    border-radius: 16px;
    padding: 1.3rem 1.5rem 1.1rem;
    box-shadow: 0 1px 6px rgba(0,0,0,0.06);
    transition: border-color .2s ease, box-shadow .2s ease, transform .2s ease;
    min-height: 168px;
}
.s-card:hover { border-color: #86efac; box-shadow: 0 4px 20px rgba(22,163,74,0.1); transform: translateY(-2px); }
.sc-header { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.5rem; }
.sc-icon { font-size: 1.25rem; }
.sc-label { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #9ca3af; }
.sc-value { font-size: 2.6rem; font-weight: 800; color: #111827; font-family: 'JetBrains Mono', monospace; line-height: 1.05; margin: 0.15rem 0; }
.sc-unit { font-size: 1.1rem; font-weight: 400; color: #9ca3af; margin-left: 3px; }
.sc-bar-track { height: 4px; background: #f3f4f6; border-radius: 99px; margin: 0.65rem 0 0.5rem; overflow: hidden; }
.sc-bar { height: 100%; border-radius: 99px; transition: width 1.2s ease; }
.bar-moisture { background: linear-gradient(90deg, #3b82f6, #93c5fd); }
.bar-temp     { background: linear-gradient(90deg, #f59e0b, #fde68a); }
.bar-hum      { background: linear-gradient(90deg, #14b8a6, #5eead4); }
.sc-status { font-size: 0.72rem; color: #16a34a; font-weight: 600; }

/* ── Pump card ── */
.pump-card { text-align: center; }
.pump-wrap { display: flex; flex-direction: column; align-items: center; gap: 0.4rem; margin: 0.2rem 0 0.4rem; }
.pump-ring {
    width: 76px; height: 76px; border-radius: 50%;
    border: 3px solid #e5e7eb;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.88rem; font-weight: 700; font-family: 'JetBrains Mono', monospace;
    color: #9ca3af; transition: all 0.5s ease;
}
.pump-ring.on {
    border-color: #16a34a;
    box-shadow: 0 0 20px rgba(22,163,74,0.25);
    color: #16a34a; background: #f0fdf4;
    animation: pump-pulse 2.2s ease-in-out infinite;
}
@keyframes pump-pulse {
    0%,100% { box-shadow: 0 0 16px rgba(22,163,74,0.2); }
    50%      { box-shadow: 0 0 30px rgba(22,163,74,0.45); }
}
.pump-mode { font-size: 0.68rem; color: #9ca3af; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }

/* ── Info box ── */
.glass-box {
    background: #f9fafb;
    border: 1.5px solid #e5e7eb;
    border-radius: 16px; padding: 1.4rem 1.6rem;
}

/* ── Irrigation thresholds ── */
.thresh-pill {
    display: inline-block; font-size: 0.7rem; font-weight: 600;
    padding: 4px 12px; border-radius: 99px; margin-right: 6px;
    font-family: 'JetBrains Mono', monospace;
}
.thresh-on  { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
.thresh-off { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
.irrig-desc { font-size: 0.81rem; color: #6b7280; line-height: 1.65; margin: 0.5rem 0 0; }

/* ── AI result cards ── */
.health-row {
    display: flex; align-items: center; gap: 1.4rem;
    background: #f0fdf4; border-radius: 14px;
    border: 1.5px solid #bbf7d0; padding: 1.2rem 1.4rem;
    margin-bottom: 1rem;
}
.hs-score { font-size: 3rem; font-weight: 900; font-family: 'JetBrains Mono', monospace; line-height: 1; }
.hs-label { font-size: 0.68rem; color: #9ca3af; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; }
.hs-health { font-size: 1.2rem; font-weight: 700; margin-top: 2px; }
.hs-urgency { font-size: 0.7rem; color: #9ca3af; margin-top: 4px; }
.hc-good     { color: #16a34a; }
.hc-fair     { color: #d97706; }
.hc-poor     { color: #ea580c; }
.hc-critical { color: #dc2626; }

.result-item {
    background: #f9fafb;
    border: 1.5px solid #e5e7eb;
    border-radius: 10px; padding: 0.85rem 1rem; margin-bottom: 0.55rem;
}
.ri-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem; }
.ri-name { font-weight: 600; color: #111827; font-size: 0.86rem; }
.ri-body { font-size: 0.76rem; color: #6b7280; line-height: 1.65; }
.ri-body strong { color: #374151; }
.rbadge { font-size: 0.62rem; font-weight: 700; padding: 2px 9px; border-radius: 99px; }
.rbadge-high   { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
.rbadge-medium { background: #fffbeb; color: #d97706; border: 1px solid #fde68a; }
.rbadge-low    { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
.no-issue { font-size: 0.8rem; color: #9ca3af; padding: 0.6rem; text-align: center; }
.rec-item { font-size: 0.78rem; color: #374151; line-height: 1.65; padding: 0.2rem 0; }
.rec-item::before { content: '→ '; color: #16a34a; font-weight: 700; }

/* ── Streamlit widget overrides ── */
div[data-testid="stButton"] > button {
    background: #f0fdf4 !important;
    border: 1.5px solid #bbf7d0 !important;
    color: #16a34a !important; border-radius: 10px !important;
    font-weight: 600 !important; font-size: 0.85rem !important;
    transition: all 0.2s ease !important;
}
div[data-testid="stButton"] > button:hover {
    background: #dcfce7 !important;
    border-color: #16a34a !important;
    box-shadow: 0 2px 12px rgba(22,163,74,0.15) !important;
    transform: translateY(-1px) !important;
}
div[data-testid="stFileUploader"] {
    background: #f9fafb !important;
    border: 2px dashed #bbf7d0 !important;
    border-radius: 14px !important;
}
div[data-testid="stFileUploader"]:hover { border-color: #16a34a !important; }
div[data-testid="stTabs"] [role="tablist"] button {
    color: #9ca3af !important; font-weight: 600 !important; font-size: 0.82rem !important;
}
div[data-testid="stTabs"] [role="tablist"] button[aria-selected="true"] {
    color: #16a34a !important; border-bottom-color: #16a34a !important;
}
div[data-testid="stTabs"] [role="tablist"] { border-bottom-color: #e5e7eb !important; }
div[data-testid="stRadio"] label { color: #374151 !important; font-size: 0.84rem !important; }
div[data-testid="stRadio"] [data-testid="stMarkdownContainer"] p { color: #374151 !important; }
.stSpinner > div { border-top-color: #16a34a !important; }
.stAlert { border-radius: 12px !important; }
div[data-testid="stImage"] { border-radius: 12px; overflow: hidden; }
[data-testid="stMetricValue"] { font-family: 'JetBrains Mono', monospace !important; color: #111827 !important; }
[data-testid="stMetricLabel"] { color: #9ca3af !important; font-size: 0.72rem !important; text-transform: uppercase !important; letter-spacing: 0.08em !important; }
div.stMarkdown p { color: #374151 !important; }
</style>
""", unsafe_allow_html=True)


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _fmt(ts: str) -> str:
    if not ts: return "--"
    try:
        return datetime.fromisoformat(ts).strftime("%H:%M")
    except Exception:
        return ts[:5] if len(ts) >= 5 else "--"

def _moisture_desc(v: float) -> str:
    if v < 20:  return "🏜️ Critically dry"
    if v < 35:  return "⚠️ Low moisture"
    if v < 65:  return "✅ Optimal range"
    return "💦 Well irrigated"

def _temp_desc(v: float) -> str:
    if v < 10:  return "🥶 Very cold"
    if v < 18:  return "❄️ Cool"
    if v < 28:  return "✅ Optimal"
    if v < 36:  return "☀️ Warm"
    return "🔥 Very hot"

def _hum_desc(v: float) -> str:
    if v < 20:  return "🏜️ Very dry"
    if v < 40:  return "☀️ Dry air"
    if v < 70:  return "✅ Good humidity"
    if v < 85:  return "💧 Humid"
    return "🌧️ Very humid"

def _health_cls(h: str) -> str:
    return {"Good":"hc-good","Fair":"hc-fair","Poor":"hc-poor","Critical":"hc-critical"}.get(h, "hc-fair")

def _health_emoji(h: str) -> str:
    return {"Good":"💚","Fair":"💛","Poor":"🟠","Critical":"🔴"}.get(h, "⚪")

def _badge_cls(level: str) -> str:
    return {"High":"rbadge-high","Medium":"rbadge-medium","Low":"rbadge-low"}.get(level, "rbadge-low")

def _render_items(items: list, kind: str) -> str:
    if not items:
        return '<div class="no-issue">✅ None detected</div>'
    out = []
    for item in items:
        if kind == "disease":
            conf = item.get("confidence", "Low")
            out.append(f"""<div class="result-item">
              <div class="ri-head">
                <span class="ri-name">🦠 {item.get('name','—')}</span>
                <span class="rbadge {_badge_cls(conf)}">{conf} Confidence</span>
              </div>
              <div class="ri-body">
                <strong>Affected area:</strong> {item.get('affected_area','N/A')}<br>
                <strong>Treatment:</strong> {item.get('treatment','N/A')}
              </div>
            </div>""")
        elif kind == "pest":
            risk = item.get("risk_level", "Low")
            out.append(f"""<div class="result-item">
              <div class="ri-head">
                <span class="ri-name">🐛 {item.get('name','—')}</span>
                <span class="rbadge {_badge_cls(risk)}">{risk} Risk</span>
              </div>
              <div class="ri-body">
                <strong>Signs:</strong> {item.get('signs','N/A')}<br>
                <strong>Control:</strong> {item.get('control','N/A')}
              </div>
            </div>""")
        elif kind == "nutrient":
            out.append(f"""<div class="result-item">
              <div class="ri-head"><span class="ri-name">🧪 {item.get('type','—')} Deficiency</span></div>
              <div class="ri-body">
                <strong>Symptoms:</strong> {item.get('symptoms','N/A')}<br>
                <strong>Remedy:</strong> {item.get('remedy','N/A')}
              </div>
            </div>""")
    return "".join(out)

# ─────────────────────────────────────────────────────────────────────────────
# AI ANALYSIS (direct Gemini call — no FastAPI round-trip needed)
# ─────────────────────────────────────────────────────────────────────────────
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


def _run_analysis(image_bytes: bytes, filename: str) -> dict:
    from google import genai
    from google.genai import types

    api_key = _api_key()
    if not api_key:
        raise ValueError("Gemini API key not configured. Add it to .streamlit/secrets.toml.")

    client = genai.Client(api_key=api_key)

    last_err: Exception | None = None
    for i, model_name in enumerate(GEMINI_MODELS):
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=[
                    ANALYSIS_PROMPT,
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    http_options=types.HttpOptions(timeout=40000),
                ),
            )
            raw      = response.text.strip().replace("```json", "").replace("```", "").strip()
            analysis = json.loads(raw)
            db.insert_analysis(filename, analysis.get("overall_health", "Unknown"), json.dumps(analysis))
            return analysis
        except Exception as e:
            last_err = e
            wait = min(2 ** i, 8)   # exponential backoff: 1s, 2s, 4s, 8s …
            time.sleep(wait)
            continue

    raise ValueError(f"All models failed (overloaded or unavailable). Last error: {last_err}")


# ─────────────────────────────────────────────────────────────────────────────
# HEADER
# ─────────────────────────────────────────────────────────────────────────────
irrig_header = get_state()
is_demo = True  # will update below

latest_check = db.get_latest_reading()
has_data     = latest_check is not None

st.markdown(f"""
<div class="cm-header">
  <div class="cm-logo">
    <div class="cm-logo-icon">🌿</div>
    <div>
      <div class="cm-logo-title">CropMonitor <span>AI</span></div>
      <div class="cm-logo-sub">Smart Farming System</div>
    </div>
  </div>
  <div style="display:flex;gap:0.6rem;align-items:center;">
    <span class="cm-badge cm-badge-demo">
      <span class="cm-dot cm-dot-demo"></span>Demo Mode Active
    </span>
  </div>
</div>
""", unsafe_allow_html=True)


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 1 — LIVE SENSOR DATA  (auto-refreshes every 3 s)
# ─────────────────────────────────────────────────────────────────────────────
@st.fragment(run_every=3)
def _sensor_section():
    data  = db.get_latest_reading()
    state = get_state()

    st.markdown('<div class="sec-title">📡 Live Sensor Data</div>', unsafe_allow_html=True)

    if not data:
        st.info("⏳ Waiting for first sensor reading…  (demo data starts in ~8 s)")
        return

    m  = float(data.get("moisture",    0))
    t  = float(data.get("temperature", 0))
    h  = float(data.get("humidity",    0))
    p  = bool(data.get("pump_state",   0))
    ts = data.get("timestamp", "")

    c1, c2, c3, c4 = st.columns(4)

    with c1:
        bar_w = min(m, 100)
        st.markdown(f"""<div class="s-card">
          <div class="sc-header"><span class="sc-icon">💧</span><span class="sc-label">Soil Moisture</span></div>
          <div class="sc-value">{m:.1f}<span class="sc-unit">%</span></div>
          <div class="sc-bar-track"><div class="sc-bar bar-moisture" style="width:{bar_w:.0f}%"></div></div>
          <div class="sc-status">{_moisture_desc(m)}</div>
        </div>""", unsafe_allow_html=True)

    with c2:
        bar_w = min((t / 50) * 100, 100)
        st.markdown(f"""<div class="s-card">
          <div class="sc-header"><span class="sc-icon">🌡️</span><span class="sc-label">Temperature</span></div>
          <div class="sc-value">{t:.1f}<span class="sc-unit">°C</span></div>
          <div class="sc-bar-track"><div class="sc-bar bar-temp" style="width:{bar_w:.0f}%"></div></div>
          <div class="sc-status">{_temp_desc(t)}</div>
        </div>""", unsafe_allow_html=True)

    with c3:
        bar_w = min(h, 100)
        st.markdown(f"""<div class="s-card">
          <div class="sc-header"><span class="sc-icon">🌫️</span><span class="sc-label">Humidity</span></div>
          <div class="sc-value">{h:.1f}<span class="sc-unit">%</span></div>
          <div class="sc-bar-track"><div class="sc-bar bar-hum" style="width:{bar_w:.0f}%"></div></div>
          <div class="sc-status">{_hum_desc(h)}</div>
        </div>""", unsafe_allow_html=True)

    with c4:
        pump_cls = "on" if p else ""
        pump_txt = "ON" if p else "OFF"
        mode_lbl = "Manual" if state.get("mode") == "manual" else "Auto"
        st.markdown(f"""<div class="s-card pump-card">
          <div class="sc-header" style="justify-content:center">
            <span class="sc-icon">🚿</span><span class="sc-label">Irrigation Pump</span>
          </div>
          <div class="pump-wrap">
            <div class="pump-ring {pump_cls}">{pump_txt}</div>
            <div class="pump-mode">Mode: {mode_lbl}</div>
          </div>
        </div>""", unsafe_allow_html=True)

    if ts:
        import streamlit.components.v1 as components
        components.html(f"""
        <script>
          function tick() {{
            var now = new Date();
            var h = String(now.getHours()).padStart(2,'0');
            var m = String(now.getMinutes()).padStart(2,'0');
            var el = document.getElementById('liveclock');
            if (el) el.textContent = h + ':' + m;
          }}
          tick();
          setInterval(tick, 15000);
        </script>
        <div style="font-size:0.75rem;color:#6b7280;margin-top:-6px;padding:0 2px;font-family:Inter,sans-serif;">
          🕐 Live: <strong id="liveclock" style="color:#16a34a;">--:--</strong>
          &nbsp;·&nbsp; Pump ON below <strong>{MOISTURE_ON}%</strong>
          &nbsp;·&nbsp; OFF above <strong>{MOISTURE_OFF}%</strong>
        </div>
        """, height=28, scrolling=False)

_sensor_section()


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 2 — 24-HOUR CHARTS  (refreshes every 10 s)
# ─────────────────────────────────────────────────────────────────────────────
@st.fragment(run_every=10)
def _chart_section():
    import plotly.graph_objects as go

    st.markdown('<div class="sec-title">📊 24-Hour Sensor Trends</div>', unsafe_allow_html=True)

    rows = db.get_recent_readings()
    if not rows:
        st.info("📊 Charts appear once sensor readings accumulate.")
        return

    labels   = [_fmt(r.get("timestamp", "")) for r in rows]
    moisture = [r.get("moisture",    0) for r in rows]
    temp     = [r.get("temperature", 0) for r in rows]
    hum      = [r.get("humidity",    0) for r in rows]

    LAYOUT = dict(
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(family="JetBrains Mono, monospace", color="#2a4535", size=10),
        margin=dict(l=48, r=16, t=16, b=48), height=240,
        xaxis=dict(
            showgrid=True, gridcolor="rgba(255,255,255,0.03)",
            linecolor="rgba(255,255,255,0.05)", tickfont=dict(size=9),
            nticks=8,
        ),
        yaxis=dict(
            showgrid=True, gridcolor="rgba(255,255,255,0.03)",
            linecolor="rgba(255,255,255,0.05)", tickfont=dict(size=9),
        ),
        showlegend=False,
        hovermode="x unified",
        hoverlabel=dict(bgcolor="rgba(8,14,10,0.95)", bordercolor="rgba(255,255,255,0.08)",
                        font=dict(color="#e8fdf0", size=11)),
    )

    def _chart(y, color, fill_color, name):
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=labels, y=y, name=name, mode="lines",
            line=dict(color=color, width=2.2, shape="spline", smoothing=0.8),
            fill="tozeroy", fillcolor=fill_color,
            hovertemplate=f"<b>{name}</b>: %{{y:.1f}}<extra></extra>",
        ))
        fig.update_layout(**LAYOUT)
        return fig

    t1, t2, t3 = st.tabs(["💧 Soil Moisture", "🌡️ Temperature", "🌫️ Humidity"])
    with t1:
        st.plotly_chart(_chart(moisture, "#60a5fa", "rgba(96,165,250,0.09)", "Moisture (%)"),
                        use_container_width=True, config={"displayModeBar": False})
    with t2:
        st.plotly_chart(_chart(temp, "#fbbf24", "rgba(251,191,36,0.09)", "Temperature (°C)"),
                        use_container_width=True, config={"displayModeBar": False})
    with t3:
        st.plotly_chart(_chart(hum, "#2dd4bf", "rgba(45,212,191,0.09)", "Humidity (%)"),
                        use_container_width=True, config={"displayModeBar": False})

_chart_section()


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 3 — IRRIGATION CONTROL
# ─────────────────────────────────────────────────────────────────────────────
st.markdown('<div class="sec-title">🚿 Irrigation Control</div>', unsafe_allow_html=True)

irrig = get_state()

col_info, col_ctrl = st.columns([2, 1], gap="large")

with col_info:
    st.markdown(f"""<div class="glass-box">
      <div style="margin-bottom:0.7rem">
        <span class="thresh-pill thresh-on">ON &lt; <strong>{MOISTURE_ON}</strong>%</span>
        <span class="thresh-pill thresh-off">OFF &gt; <strong>{MOISTURE_OFF}</strong>%</span>
      </div>
      <div class="irrig-desc">
        In <strong>Auto</strong> mode the pump activates automatically based on soil moisture thresholds.
        Switch to <strong>Manual</strong> to override and control the pump directly.
      </div>
    </div>""", unsafe_allow_html=True)

with col_ctrl:
    st.markdown('<div class="glass-box">', unsafe_allow_html=True)

    current_mode = irrig.get("mode", "auto")
    mode_choice  = st.radio(
        "Mode",
        options=["⚡ Auto", "🖐 Manual"],
        index=0 if current_mode == "auto" else 1,
        horizontal=True,
        key="mode_radio",
        label_visibility="collapsed",
    )
    selected_mode = "auto" if "Auto" in mode_choice else "manual"

    if selected_mode != current_mode:
        set_state(mode=selected_mode)
        db.insert_override(selected_mode, int(get_state()["pump_on"]))
        st.rerun()

    if selected_mode == "manual":
        bc1, bc2 = st.columns(2)
        with bc1:
            if st.button("💦 Pump ON",  key="pump_on_btn",  use_container_width=True):
                set_state(pump_on=True)
                db.insert_override("manual", 1)
                st.rerun()
        with bc2:
            if st.button("⛔ Pump OFF", key="pump_off_btn", use_container_width=True):
                set_state(pump_on=False)
                db.insert_override("manual", 0)
                st.rerun()

    st.markdown('</div>', unsafe_allow_html=True)


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 4 — AI CROP DISEASE DETECTION
# ─────────────────────────────────────────────────────────────────────────────
st.markdown('<div class="sec-title">🤖 AI Crop Disease Detection</div>', unsafe_allow_html=True)
st.markdown(
    '<p style="font-size:0.82rem;color:#6b7280;margin:-0.4rem 0 1rem;">Upload a photo of your crop — Gemini Vision AI will analyse it for diseases, pest infestations and nutrient deficiencies.</p>',
    unsafe_allow_html=True,
)

# Check API key once
raw_key = _api_key()
api_key_ok = bool(raw_key)
if not api_key_ok:
    st.warning("⚠️ Gemini API key not set. Add `GEMINI_API_KEY` to `.streamlit/secrets.toml`.", icon="⚠️")

uploaded = st.file_uploader(
    "Drop a crop photo here",
    type=["jpg", "jpeg", "png", "webp"],
    key="crop_upload",
    label_visibility="collapsed",
    disabled=not api_key_ok,
)

if uploaded:
    img_bytes = uploaded.read()

    col_img, col_btn = st.columns([3, 1], gap="medium")
    with col_img:
        st.image(img_bytes, use_container_width=True, caption=uploaded.name)
    with col_btn:
        st.markdown("<br>", unsafe_allow_html=True)
        run_analysis = st.button("🔬 Analyse with Gemini AI", key="analyse_btn", use_container_width=True)

    if run_analysis:
        with st.spinner("🌿 Analysing with Gemini Vision AI…  (3–10 seconds)"):
            try:
                result = _run_analysis(img_bytes, uploaded.name)

                score  = result.get("health_score", 0)
                health = result.get("overall_health", "Unknown")
                urgency= result.get("urgency", "Unknown")
                hcls   = _health_cls(health)

                # ── Health overview ───────────────────────────────────────────
                st.markdown(f"""<div class="health-row">
                  <div style="text-align:center;min-width:80px">
                    <div class="hs-score {hcls}">{score}</div>
                    <div class="hs-label">/ 100</div>
                  </div>
                  <div>
                    <div class="hs-label">Overall Health</div>
                    <div class="hs-health {hcls}">{_health_emoji(health)} {health}</div>
                    <div class="hs-urgency">Urgency: {urgency}</div>
                  </div>
                </div>""", unsafe_allow_html=True)

                # ── Result tabs ───────────────────────────────────────────────
                rt1, rt2, rt3, rt4 = st.tabs(["🦠 Diseases", "🐛 Pests", "🧪 Nutrients", "✅ Actions"])

                with rt1:
                    st.markdown(_render_items(result.get("diseases", []), "disease"), unsafe_allow_html=True)
                with rt2:
                    st.markdown(_render_items(result.get("pests", []), "pest"), unsafe_allow_html=True)
                with rt3:
                    st.markdown(_render_items(result.get("nutrient_deficiency", []), "nutrient"), unsafe_allow_html=True)
                with rt4:
                    recs = result.get("recommendations", [])
                    if recs:
                        for r in recs:
                            st.markdown(f'<div class="rec-item">{r}</div>', unsafe_allow_html=True)
                    else:
                        st.markdown('<div class="no-issue">✅ No specific recommendations.</div>', unsafe_allow_html=True)

            except Exception as e:
                st.error(f"⚠️ Analysis failed: {e}", icon="⚠️")


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 5 — ANALYSIS HISTORY  (collapsible)
# ─────────────────────────────────────────────────────────────────────────────
history_rows = db.get_recent_analyses()
if history_rows:
    with st.expander(f"📋 Analysis History  ({len(history_rows)} records)", expanded=False):
        for row in history_rows:
            try:
                result = json.loads(row.get("result_json", "{}"))
                health = row.get("overall_health", "—")
                hcls   = _health_cls(health)
                st.markdown(f"""<div class="result-item">
                  <div class="ri-head">
                    <span class="ri-name">{_health_emoji(health)} {row.get('image_name','—')}</span>
                    <span class="rbadge {hcls.replace('hc-','rbadge-')}" style="font-size:0.7rem;padding:3px 10px;">{health}</span>
                  </div>
                  <div class="ri-body">
                    Score: <strong>{result.get('health_score','—')}/100</strong> ·
                    Urgency: <strong>{result.get('urgency','—')}</strong> ·
                    {_fmt(row.get('timestamp',''))}
                  </div>
                </div>""", unsafe_allow_html=True)
            except Exception:
                continue


# ─────────────────────────────────────────────────────────────────────────────
# FOOTER
# ─────────────────────────────────────────────────────────────────────────────
st.markdown("""
<div style="margin-top:3rem;padding-top:1.2rem;border-top:2px solid #f3f4f6;
            text-align:center;font-size:0.7rem;color:#9ca3af;font-family:'JetBrains Mono',monospace;">
  🌿 CropMonitor AI &nbsp;·&nbsp; Powered by Google Gemini Vision &nbsp;·&nbsp; ESP32 + DHT22 + Soil Sensor
</div>
""", unsafe_allow_html=True)
