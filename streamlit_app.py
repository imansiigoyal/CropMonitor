"""
CropMonitor AI — Smart Farming & AgriBot Assistant
Deployable on Streamlit Community Cloud (streamlit.io) and local Streamlit
"""

import os
import json
import sqlite3
import datetime
from pathlib import Path
from PIL import Image
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from dotenv import load_dotenv

# ── Load environment / secrets ──────────────────────────────────────────────
load_dotenv()
load_dotenv(Path(__file__).parent / "CropMonitor" / "backend" / ".env")

def get_api_key():
    """Retrieve Gemini API key from Streamlit secrets, env, or session."""
    if "GEMINI_API_KEY" in st.secrets:
        return st.secrets["GEMINI_API_KEY"]
    if os.getenv("GEMINI_API_KEY"):
        return os.getenv("GEMINI_API_KEY")
    return st.session_state.get("user_gemini_key", "")

# ── Page Configuration ──────────────────────────────────────────────────────
st.set_page_config(
    page_title="CropMonitor AI — Smart Farming & AgriBot",
    page_icon="🌿",
    layout="wide",
    initial_sidebar_state="expanded"
)

# ── Database Layer (SQLite) ─────────────────────────────────────────────────
DB_PATH = Path(__file__).parent / "CropMonitor" / "backend" / "cropmonitor.db"
if not DB_PATH.parent.exists():
    DB_PATH = Path(__file__).parent / "cropmonitor.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sensor_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT DEFAULT (datetime('now','localtime')),
            moisture REAL NOT NULL,
            temperature REAL NOT NULL,
            humidity REAL NOT NULL,
            pump_state INTEGER NOT NULL DEFAULT 0
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS ai_analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT DEFAULT (datetime('now','localtime')),
            image_name TEXT,
            overall_health TEXT,
            result_json TEXT NOT NULL
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS irrigation_overrides (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT DEFAULT (datetime('now','localtime')),
            mode TEXT NOT NULL,
            pump_state INTEGER NOT NULL
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT DEFAULT (datetime('now','localtime')),
            role TEXT NOT NULL,
            content TEXT NOT NULL
        )
    """)
    conn.commit()

    # Seed initial sensor reading if empty
    cur.execute("SELECT COUNT(*) FROM sensor_readings")
    if cur.fetchone()[0] == 0:
        base_time = datetime.datetime.now() - datetime.timedelta(hours=12)
        sample_readings = [
            (base_time + datetime.timedelta(hours=i), 28 + (i * 2.5) % 35, 24 + (i * 1.2) % 10, 60 + (i * 1.5) % 25, 1 if (28 + (i * 2.5) % 35) < 30 else 0)
            for i in range(24)
        ]
        cur.executemany(
            "INSERT INTO sensor_readings (timestamp, moisture, temperature, humidity, pump_state) VALUES (?, ?, ?, ?, ?)",
            [(t.strftime("%Y-%m-%d %H:%M:%S"), m, temp, h, p) for t, m, temp, h, p in sample_readings]
        )
        conn.commit()
    conn.close()

def get_latest_reading():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT timestamp, moisture, temperature, humidity, pump_state FROM sensor_readings ORDER BY id DESC LIMIT 1")
    row = cur.fetchone()
    conn.close()
    if row:
        return {"timestamp": row[0], "moisture": row[1], "temperature": row[2], "humidity": row[3], "pump_state": row[4]}
    return {"timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "moisture": 45.0, "temperature": 26.5, "humidity": 65.0, "pump_state": 0}

def get_history_readings(limit=100):
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query(f"SELECT timestamp, moisture, temperature, humidity, pump_state FROM sensor_readings ORDER BY id DESC LIMIT {limit}", conn)
    conn.close()
    if not df.empty:
        df = df.iloc[::-1].reset_index(drop=True)
    return df

def insert_sensor_reading(moisture, temperature, humidity, pump_state):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO sensor_readings (moisture, temperature, humidity, pump_state) VALUES (?, ?, ?, ?)",
        (moisture, temperature, humidity, pump_state)
    )
    conn.commit()
    conn.close()

def get_latest_analysis():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT timestamp, image_name, overall_health, result_json FROM ai_analyses ORDER BY id DESC LIMIT 1")
    row = cur.fetchone()
    conn.close()
    if row:
        try:
            return {"timestamp": row[0], "image_name": row[1], "overall_health": row[2], "data": json.loads(row[3])}
        except:
            return None
    return None

def save_analysis(image_name, overall_health, data_dict):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO ai_analyses (image_name, overall_health, result_json) VALUES (?, ?, ?)",
        (image_name, overall_health, json.dumps(data_dict))
    )
    conn.commit()
    conn.close()

init_db()

# ── Custom CSS for Modern Agriculture Glassmorphism UI ──────────────────────
st.markdown("""
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

  html, body, [class*="css"] {
    font-family: 'Inter', sans-serif;
  }

  /* Metric Card styling */
  .crop-metric-card {
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 1.25rem 1.4rem;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
    transition: transform 0.2s ease, border-color 0.2s ease;
  }
  .crop-metric-card:hover {
    transform: translateY(-2px);
    border-color: rgba(74, 222, 128, 0.35);
  }
  .crop-metric-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .crop-metric-title {
    font-size: 0.82rem;
    font-weight: 600;
    color: #86efac;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .crop-metric-icon {
    font-size: 1.4rem;
  }
  .crop-metric-val {
    font-size: 2.2rem;
    font-weight: 800;
    color: #e8fdf0;
    font-family: 'JetBrains Mono', monospace;
    line-height: 1.1;
  }
  .crop-metric-sub {
    font-size: 0.75rem;
    color: #4d7c5b;
    margin-top: 0.4rem;
  }

  /* Status badge */
  .badge-pump-on {
    display: inline-block;
    padding: 0.25rem 0.65rem;
    background: rgba(34, 197, 94, 0.2);
    border: 1px solid #22c55e;
    color: #4ade80;
    border-radius: 100px;
    font-size: 0.75rem;
    font-weight: 700;
    animation: pulseGlow 2s infinite;
  }
  .badge-pump-off {
    display: inline-block;
    padding: 0.25rem 0.65rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #94a3b8;
    border-radius: 100px;
    font-size: 0.75rem;
    font-weight: 600;
  }
  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 10px rgba(34, 197, 94, 0.4); }
    50% { box-shadow: 0 0 2px rgba(34, 197, 94, 0.1); }
  }

  /* Banner alert */
  .alert-banner {
    padding: 0.75rem 1.25rem;
    border-radius: 12px;
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.3);
    color: #fbbf24;
    font-size: 0.85rem;
    margin-bottom: 1.25rem;
  }
  .alert-banner.crit {
    background: rgba(248, 113, 113, 0.1);
    border-color: rgba(248, 113, 113, 0.35);
    color: #f87171;
  }

  /* Prompt pill buttons */
  .stButton button {
    border-radius: 10px;
    transition: all 0.2s ease;
  }
</style>
""", unsafe_allow_html=True)

# ── Sidebar Controls ────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("## 🌿 CropMonitor AI")
    st.caption("Smart Crop Monitoring & Automated Irrigation")
    st.divider()

    # Gemini API Key Management
    current_key = get_api_key()
    if not current_key or current_key == "your_gemini_api_key_here":
        st.warning("⚠️ Gemini API Key not detected.")
        user_key = st.text_input("Enter Gemini API Key:", type="password", help="Get your free key from aistudio.google.com")
        if user_key:
            st.session_state["user_gemini_key"] = user_key
            st.success("Key registered!")
            st.rerun()
    else:
        st.success("✅ Gemini AI Connected")

    st.divider()
    st.markdown("### 🚿 Irrigation Controls")

    # Irrigation Mode
    if "irrigation_mode" not in st.session_state:
        st.session_state["irrigation_mode"] = "Auto"
    if "manual_pump_state" not in st.session_state:
        st.session_state["manual_pump_state"] = False

    irrig_mode = st.radio("Irrigation Mode", ["⚡ Auto", "🖐 Manual"], index=0 if st.session_state["irrigation_mode"] == "Auto" else 1)
    st.session_state["irrigation_mode"] = "Auto" if "Auto" in irrig_mode else "Manual"

    # Thresholds
    st.markdown("#### Moisture Thresholds (%)")
    on_thresh = st.slider("Auto-ON (below %)", min_value=10, max_value=50, value=30, step=1)
    off_thresh = st.slider("Auto-OFF (above %)", min_value=50, max_value=90, value=60, step=1)

    if st.session_state["irrigation_mode"] == "Manual":
        st.markdown("#### Manual Pump Switch")
        col_p1, col_p2 = st.columns(2)
        with col_p1:
            if st.button("💦 Pump ON", use_container_width=True):
                st.session_state["manual_pump_state"] = True
                st.toast("Pump manually switched ON!")
        with col_p2:
            if st.button("⛔ Pump OFF", use_container_width=True):
                st.session_state["manual_pump_state"] = False
                st.toast("Pump manually switched OFF!")

    st.divider()
    st.markdown("### 🧪 Simulator")
    with st.expander("Simulate Sensor Data"):
        sim_moist = st.slider("Moisture (%)", 5.0, 95.0, 22.0, 0.5)
        sim_temp = st.slider("Temperature (°C)", 10.0, 48.0, 28.5, 0.5)
        sim_hum = st.slider("Humidity (%)", 15.0, 95.0, 65.0, 1.0)
        if st.button("Inject Sensor Reading"):
            # Compute pump state
            p_on = 1 if sim_moist < on_thresh else 0
            insert_sensor_reading(sim_moist, sim_temp, sim_hum, p_on)
            st.success(f"Injected: {sim_moist}% moisture, {sim_temp}°C")
            st.rerun()

    st.caption("v2.0 • Streamlit Cloud Edition")

# ── Header Bar ──────────────────────────────────────────────────────────────
col_h1, col_h2 = st.columns([3, 1])
with col_h1:
    st.markdown("# 🌿 CropMonitor AI Dashboard")
    st.markdown("Automated smart irrigation, Gemini Vision crop diagnostics, and real-time AgriBot assistance.")
with col_h2:
    latest = get_latest_reading()
    st.markdown(f"<div style='text-align:right; color:#86efac; font-family:monospace; font-size:0.8rem;'>Last Synced: {latest['timestamp']}</div>", unsafe_allow_html=True)

# ── Main Tabs ───────────────────────────────────────────────────────────────
tab_dash, tab_vision, tab_chat, tab_iot = st.tabs([
    "📡 Live Dashboard & Irrigation",
    "🔬 AI Crop Disease Detection",
    "💬 AgriBot AI Assistant",
    "⚙️ IoT & ESP32 Integration"
])

# ══════════════════════════════════════════════════════════════════════════════
# TAB 1: LIVE DASHBOARD
# ══════════════════════════════════════════════════════════════════════════════
with tab_dash:
    latest = get_latest_reading()

    # Determine pump state based on mode
    if st.session_state["irrigation_mode"] == "Manual":
        is_pump_on = st.session_state["manual_pump_state"]
        pump_label = "MANUAL ON" if is_pump_on else "MANUAL OFF"
    else:
        is_pump_on = latest["moisture"] < on_thresh
        pump_label = "AUTO ON" if is_pump_on else "AUTO OFF"

    # Critical Alert Banners
    if latest["moisture"] < (on_thresh - 8):
        st.markdown(f"<div class='alert-banner crit'>🚨 <strong>Critical Warning:</strong> Soil moisture is dangerously dry at <strong>{latest['moisture']:.1f}%</strong>! Irrigation pump activated.</div>", unsafe_allow_html=True)
    elif latest["temperature"] > 38.0:
        st.markdown(f"<div class='alert-banner'>☀️ <strong>Heat Stress Alert:</strong> Ambient temperature is <strong>{latest['temperature']:.1f}°C</strong>. Monitor crop transpiration and shade coverage.</div>", unsafe_allow_html=True)

    # 4 Metric Cards
    c1, c2, c3, c4 = st.columns(4)
    with c1:
        moist_color = "#f87171" if latest["moisture"] < on_thresh else "#4ade80"
        st.markdown(f"""
        <div class="crop-metric-card">
          <div class="crop-metric-header">
            <span class="crop-metric-title">Soil Moisture</span>
            <span class="crop-metric-icon">💧</span>
          </div>
          <div class="crop-metric-val" style="color:{moist_color}">{latest['moisture']:.1f}%</div>
          <div class="crop-metric-sub">Target: {on_thresh}% – {off_thresh}%</div>
        </div>
        """, unsafe_allow_html=True)

    with c2:
        st.markdown(f"""
        <div class="crop-metric-card">
          <div class="crop-metric-header">
            <span class="crop-metric-title">Temperature</span>
            <span class="crop-metric-icon">🌡️</span>
          </div>
          <div class="crop-metric-val">{latest['temperature']:.1f}°C</div>
          <div class="crop-metric-sub">Optimal: 20°C – 32°C</div>
        </div>
        """, unsafe_allow_html=True)

    with c3:
        st.markdown(f"""
        <div class="crop-metric-card">
          <div class="crop-metric-header">
            <span class="crop-metric-title">Relative Humidity</span>
            <span class="crop-metric-icon">🌫️</span>
          </div>
          <div class="crop-metric-val">{latest['humidity']:.1f}%</div>
          <div class="crop-metric-sub">Good Range: 50% – 75%</div>
        </div>
        """, unsafe_allow_html=True)

    with c4:
        badge_cls = "badge-pump-on" if is_pump_on else "badge-pump-off"
        st.markdown(f"""
        <div class="crop-metric-card">
          <div class="crop-metric-header">
            <span class="crop-metric-title">Irrigation Pump</span>
            <span class="crop-metric-icon">🚿</span>
          </div>
          <div class="crop-metric-val">{'ON 💦' if is_pump_on else 'OFF ⛔'}</div>
          <div class="crop-metric-sub"><span class="{badge_cls}">Mode: {st.session_state['irrigation_mode']}</span></div>
        </div>
        """, unsafe_allow_html=True)

    st.markdown("<br>", unsafe_allow_html=True)

    # ── Interactive 24-Hour Trend Charts ────────────────────────────────────
    st.markdown("### 📊 24-Hour Sensor Telemetry Trends")
    df_hist = get_history_readings(100)

    if not df_hist.empty:
        chart_col1, chart_col2 = st.columns([3, 1])
        with chart_col2:
            chart_metric = st.selectbox("Telemetry View", ["💧 Soil Moisture (%)", "🌡️ Temperature (°C)", "🌫️ Humidity (%)", "📈 Combined Overview"])

        fig = go.Figure()

        if chart_metric == "💧 Soil Moisture (%)":
            fig.add_trace(go.Scatter(
                x=df_hist['timestamp'], y=df_hist['moisture'],
                mode='lines+markers', name='Soil Moisture (%)',
                line=dict(color='#60a5fa', width=3, shape='spline'),
                fill='tozeroy', fillcolor='rgba(96, 165, 250, 0.1)'
            ))
            fig.add_hline(y=on_thresh, line_dash="dash", line_color="#f87171", annotation_text=f"Auto-ON ({on_thresh}%)")
            fig.add_hline(y=off_thresh, line_dash="dash", line_color="#4ade80", annotation_text=f"Auto-OFF ({off_thresh}%)")

        elif chart_metric == "🌡️ Temperature (°C)":
            fig.add_trace(go.Scatter(
                x=df_hist['timestamp'], y=df_hist['temperature'],
                mode='lines+markers', name='Temperature (°C)',
                line=dict(color='#fbbf24', width=3, shape='spline'),
                fill='tozeroy', fillcolor='rgba(251, 191, 36, 0.1)'
            ))
            fig.add_hline(y=35.0, line_dash="dot", line_color="#f87171", annotation_text="Heat Warning (35°C)")

        elif chart_metric == "🌫️ Humidity (%)":
            fig.add_trace(go.Scatter(
                x=df_hist['timestamp'], y=df_hist['humidity'],
                mode='lines+markers', name='Humidity (%)',
                line=dict(color='#2dd4bf', width=3, shape='spline'),
                fill='tozeroy', fillcolor='rgba(45, 212, 191, 0.1)'
            ))

        else:
            fig.add_trace(go.Scatter(x=df_hist['timestamp'], y=df_hist['moisture'], mode='lines', name='Moisture (%)', line=dict(color='#60a5fa', width=2.5)))
            fig.add_trace(go.Scatter(x=df_hist['timestamp'], y=df_hist['temperature'], mode='lines', name='Temp (°C)', line=dict(color='#fbbf24', width=2.5)))
            fig.add_trace(go.Scatter(x=df_hist['timestamp'], y=df_hist['humidity'], mode='lines', name='Humidity (%)', line=dict(color='#2dd4bf', width=2.5)))

        fig.update_layout(
            paper_bgcolor='rgba(0,0,0,0)',
            plot_bgcolor='rgba(255,255,255,0.02)',
            font=dict(color='#e8fdf0', family='Inter'),
            margin=dict(l=20, r=20, t=30, b=20),
            height=340,
            xaxis=dict(gridcolor='rgba(255,255,255,0.05)', showgrid=True),
            yaxis=dict(gridcolor='rgba(255,255,255,0.05)', showgrid=True),
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1)
        )
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("No sensor records available yet. Use the simulator in the sidebar to add readings.")

# ══════════════════════════════════════════════════════════════════════════════
# TAB 2: AI CROP DISEASE DETECTION
# ══════════════════════════════════════════════════════════════════════════════
with tab_vision:
    st.markdown("### 🔬 Gemini Vision AI Crop Disease & Pest Analysis")
    st.markdown("Upload or snap a photo of any crop leaf, stem, or fruit. Gemini AI identifies infections, pests, and nutrient deficiencies with actionable treatment steps.")

    col_v1, col_v2 = st.columns([1, 1])
    img_to_analyze = None
    img_source_name = ""

    with col_v1:
        input_type = st.radio("Image Input Mode:", ["📁 File Upload", "📷 Camera Snapshot", "🧪 Load Demo Pest Photo"], horizontal=True)

        if input_type == "📁 File Upload":
            uploaded_file = st.file_uploader("Upload Crop Photo (JPG, PNG, WebP):", type=["jpg", "jpeg", "png", "webp"])
            if uploaded_file:
                img_to_analyze = Image.open(uploaded_file)
                img_source_name = uploaded_file.name
                st.image(img_to_analyze, caption="Selected Crop Image", use_container_width=True)

        elif input_type == "📷 Camera Snapshot":
            camera_file = st.camera_input("Take a photo of the crop:")
            if camera_file:
                img_to_analyze = Image.open(camera_file)
                img_source_name = "camera_snapshot.jpg"

        else:
            demo_path = Path(__file__).parent / "pest.jpg"
            if demo_path.exists():
                img_to_analyze = Image.open(demo_path)
                img_source_name = "pest.jpg"
                st.image(img_to_analyze, caption="Demo: Bean Leaf Beetle Damage (pest.jpg)", use_container_width=True)
            else:
                st.warning("pest.jpg not found in workspace.")

        analyze_btn = st.button("🔬 Analyse Crop Health with Gemini Vision", type="primary", disabled=img_to_analyze is None)

    with col_v2:
        if analyze_btn and img_to_analyze:
            api_key = get_api_key()
            if not api_key:
                st.error("Please provide a Gemini API Key in the sidebar or Streamlit secrets.")
            else:
                with st.spinner("Analyzing plant pathology with Gemini Vision AI…"):
                    try:
                        from google import genai

                        client = genai.Client(api_key=api_key)

                        prompt = """You are an expert agricultural scientist, botanist, and plant pathologist.
Analyze this crop image thoroughly. Identify the specific crop, its growth stage, and assess its overall health.
Even if the crop is healthy with no active infection, provide crop-specific analysis, preventive disease/pest watches, nutrient advice, and care recommendations tailored specifically to this plant.

Return ONLY a valid JSON object with NO markdown code fences or surrounding text:
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
      "type": "Specific nutrient or 'Optimal Balance'",
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
Do NOT return empty disease or pest lists. If the crop is healthy with no visible infection, include the top 2-3 common diseases and pests that affect this specific crop at this growth stage under 'Preventive Watch' status so the grower has proactive crop care instructions!"""

                        response = client.models.generate_content(
                            model="gemini-3.5-flash-lite",
                            contents=[img_to_analyze, prompt]
                        )
                        raw_text = response.text.strip()
                        clean_json = raw_text.replace("```json", "").replace("```", "").strip()
                        analysis_data = json.loads(clean_json)

                        # Save to DB
                        save_analysis(img_source_name, analysis_data.get("overall_health", "Unknown"), analysis_data)
                        st.session_state["latest_analysis"] = analysis_data

                    except Exception as ex:
                        st.error(f"Analysis failed: {str(ex)}")

        # Render Latest Analysis
        analysis_to_show = st.session_state.get("latest_analysis") or (get_latest_analysis()["data"] if get_latest_analysis() else None)

        if analysis_to_show:
            st.markdown("#### Diagnosis Results")
            score = analysis_to_show.get("health_score", 75)
            health = analysis_to_show.get("overall_health", "Fair")
            urgency = analysis_to_show.get("urgency", "Routine monitoring")
            crop_n = analysis_to_show.get("crop_name", "Identified Crop")
            crop_sci = analysis_to_show.get("scientific_name", "")
            crop_stage = analysis_to_show.get("growth_stage", "Active Growth")

            score_color = "#4ade80" if score > 70 else "#fbbf24" if score > 45 else "#f87171"

            # Crop Identity Card
            st.markdown(f"""
            <div style="background:linear-gradient(135deg, rgba(74,222,128,0.12), rgba(45,212,191,0.08)); padding:1.1rem 1.3rem; border-radius:14px; border:1px solid rgba(74,222,128,0.35); margin-bottom:1rem;">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
                <div>
                  <span style="font-size:0.7rem; color:#4ade80; text-transform:uppercase; font-weight:800; letter-spacing:0.06em;">🌾 Identified Crop</span>
                  <div style="font-size:1.4rem; font-weight:800; color:#e8fdf0;">{crop_n} <span style="font-size:0.85rem; color:#2dd4bf; font-style:italic;">({crop_sci})</span></div>
                </div>
                <div style="text-align:right; background:rgba(0,0,0,0.3); padding:0.4rem 0.8rem; border-radius:8px; border:1px solid rgba(255,255,255,0.08);">
                  <span style="font-size:0.68rem; color:#86efac; display:block;">Growth Stage:</span>
                  <strong style="font-size:0.95rem; color:#fbbf24;">{crop_stage}</strong>
                </div>
              </div>
            </div>
            """, unsafe_allow_html=True)

            # Overall Health Block
            st.markdown(f"""
            <div style="background:rgba(255,255,255,0.035); padding:1rem; border-radius:14px; border:1px solid rgba(255,255,255,0.08); margin-bottom:1rem;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <span style="font-size:0.75rem; color:#86efac; text-transform:uppercase;">Overall Health Score</span>
                  <div style="font-size:1.6rem; font-weight:800; color:{score_color}">{health} ({score}/100)</div>
                </div>
                <div style="background:rgba(74,222,128,0.15); padding:0.3rem 0.8rem; border-radius:100px; color:#4ade80; font-size:0.8rem; font-weight:700;">
                  Urgency: {urgency}
                </div>
              </div>
            </div>
            """, unsafe_allow_html=True)
            st.progress(score / 100)

            # Visual Assessment
            if analysis_to_show.get("visual_assessment"):
                st.info(f"🔍 **Agronomic Visual Assessment:** {analysis_to_show.get('visual_assessment')}")

            # Diseases & Preventive Health Watch
            diseases = analysis_to_show.get("diseases", [])
            if diseases:
                st.markdown("##### 🦠 Diseases & Health Watch")
                for d in diseases:
                    status = d.get("status", "Watch")
                    is_active = "active" in status.lower() or "infect" in status.lower()
                    status_prefix = "🚨 ACTIVE INFECTION" if is_active else "🛡️ PREVENTIVE WATCH"
                    if is_active:
                        st.error(f"**{d.get('name')}** — `{status_prefix}` ({d.get('confidence')} Confidence)\n- **Affected Area:** {d.get('affected_area')}\n- **Treatment:** {d.get('treatment')}")
                    else:
                        st.warning(f"**{d.get('name')}** — `{status_prefix}` ({d.get('confidence')} Confidence)\n- **Target Area:** {d.get('affected_area')}\n- **Preventive Care:** {d.get('treatment')}")

            # Pests & Threat Watch
            pests = analysis_to_show.get("pests", [])
            if pests:
                st.markdown("##### 🐛 Pests & Threat Watch")
                for p in pests:
                    status = p.get("status", "Threat Watch")
                    is_active = "active" in status.lower() or "infest" in status.lower()
                    status_prefix = "🚨 ACTIVE INFESTATION" if is_active else "🛡️ COMMON THREAT WATCH"
                    if is_active:
                        st.error(f"**{p.get('name')}** — `{status_prefix}` (Risk: {p.get('risk_level')})\n- **Visible Signs:** {p.get('signs')}\n- **Control:** {p.get('control')}")
                    else:
                        st.warning(f"**{p.get('name')}** — `{status_prefix}` (Risk: {p.get('risk_level')})\n- **Signs to Monitor:** {p.get('signs')}\n- **Preventive Spray / Control:** {p.get('control')}")

            # Nutrient Deficiencies & Soil
            nutrients = analysis_to_show.get("nutrient_deficiency", [])
            if nutrients:
                st.markdown("##### 🧪 Nutrients & Soil Health")
                for n in nutrients:
                    st.info(f"**{n.get('type')}**\n- **Symptoms / Stage Needs:** {n.get('symptoms')}\n- **Fertilizer Remedy:** {n.get('remedy')}")

            # Soil & Irrigation Guide
            soil_guide = analysis_to_show.get("soil_irrigation_guide")
            if soil_guide:
                st.markdown(f"##### 💧 Stage-Specific Irrigation Guide\n{soil_guide}")

            # Recommendations
            recs = analysis_to_show.get("recommendations", [])
            if recs:
                st.markdown("##### ✅ Recommended Next Actions")
                for r in recs:
                    st.markdown(f"- 🌿 {r}")
        else:
            st.info("Upload or select a photo on the left to view diagnosis.")

# ══════════════════════════════════════════════════════════════════════════════
# TAB 3: AGRIBOT AI CHATBOT
# ══════════════════════════════════════════════════════════════════════════════
with tab_chat:
    st.markdown("### 💬 AgriBot AI — Live Context Agronomy Assistant")
    st.caption("Ask questions about your crops, pest remedies, watering schedules, or real-time sensor status.")

    # Initialize chat history in session
    if "messages" not in st.session_state:
        st.session_state.messages = [
            {
                "role": "assistant",
                "content": "Hello! I am **AgriBot AI**, your smart agronomy & farm irrigation advisor 🌿\n\nI am continuously monitoring your **live IoT sensors** (soil moisture, temperature, humidity, pump state) and crop disease scans.\n\nAsk me anything like:\n* *\"Should I water my crops right now?\"*\n* *\"Are my temperature and moisture levels optimal?\"*\n* *\"What are organic treatments for aphids or mildew?\"*"
            }
        ]

    # Quick prompt chips row
    col_chip1, col_chip2, col_chip3, col_chip4 = st.columns(4)
    quick_prompt = None
    with col_chip1:
        if st.button("💧 Check Irrigation", use_container_width=True):
            quick_prompt = "Should I water my crops right now based on our live sensor readings?"
    with col_chip2:
        if st.button("🌡️ Climate Status", use_container_width=True):
            quick_prompt = "Are my current temperature and humidity readings safe for crops?"
    with col_chip3:
        if st.button("🔬 Latest Diagnosis", use_container_width=True):
            quick_prompt = "Summarize my most recent AI crop disease scan and recommended actions."
    with col_chip4:
        if st.button("🐛 Pest Control", use_container_width=True):
            quick_prompt = "What are the most effective organic remedies for common garden and crop pests?"

    # Display chat messages
    for msg in st.session_state.messages:
        with st.chat_message(msg["role"], avatar="🌿" if msg["role"] == "assistant" else "🧑‍🌾"):
            st.markdown(msg["content"])

    # Chat Input handler
    user_query = st.chat_input("Ask AgriBot anything about your crops or farm…") or quick_prompt

    if user_query:
        # Display user message
        st.session_state.messages.append({"role": "user", "content": user_query})
        with st.chat_message("user", avatar="🧑‍🌾"):
            st.markdown(user_query)

        # Generate AgriBot Context
        api_key = get_api_key()
        if not api_key:
            with st.chat_message("assistant", avatar="🌿"):
                st.error("Please configure your Gemini API Key in the sidebar to chat with AgriBot.")
        else:
            with st.chat_message("assistant", avatar="🌿"):
                with st.spinner("AgriBot is analyzing farm conditions…"):
                    try:
                        from google import genai

                        client = genai.Client(api_key=api_key)

                        # Assemble dynamic live context
                        latest_reading = get_latest_reading()
                        last_scan = get_latest_analysis()
                        scan_str = "No recent image analysis."
                        if last_scan and "data" in last_scan:
                            d = last_scan["data"]
                            scan_str = f"Overall Health: {d.get('overall_health')} ({d.get('health_score')}/100), Diseases: {d.get('diseases')}, Pests: {d.get('pests')}, Recommendations: {d.get('recommendations')}"

                        current_pump = "ON 💦" if is_pump_on else "OFF ⛔"
                        sys_prompt = f"""You are "AgriBot AI", an expert agricultural consultant, plant pathologist, and smart irrigation assistant embedded in CropMonitor AI.

CURRENT LIVE FARM TELEMETRY:
- Soil Moisture: {latest_reading['moisture']:.1f}% (Thresholds: Auto-ON < {on_thresh}%, Auto-OFF > {off_thresh}%)
- Ambient Temperature: {latest_reading['temperature']:.1f}°C
- Relative Humidity: {latest_reading['humidity']:.1f}%
- Irrigation Pump: {current_pump} (Mode: {st.session_state['irrigation_mode']})
- Latest Crop Disease Scan: {scan_str}

GUIDELINES:
1. When asked about current farm conditions, directly cite the real-time sensor data above.
2. If soil moisture is low (< {on_thresh}%), recommend irrigation. If temperature is high (> 35°C), advise heat stress prevention.
3. For pest/disease questions, give practical, organic and conventional remedies.
4. Keep answers friendly, structured, concise, and easy to read with bullet points."""

                        # Build conversation history
                        history_contents = [sys_prompt]
                        for m in st.session_state.messages[-8:]:
                            prefix = "User: " if m["role"] == "user" else "AgriBot: "
                            history_contents.append(prefix + m["content"])

                        history_contents.append(f"User: {user_query}\nAgriBot:")

                        chat_res = client.models.generate_content(
                            model="gemini-3.5-flash-lite",
                            contents="\n\n".join(history_contents)
                        )
                        reply = chat_res.text.strip()
                        st.markdown(reply)
                        st.session_state.messages.append({"role": "assistant", "content": reply})

                    except Exception as err:
                        err_str = f"⚠️ AgriBot encountered an error: {str(err)}"
                        st.error(err_str)
                        st.session_state.messages.append({"role": "assistant", "content": err_str})

    if st.button("🗑️ Clear Chat History"):
        st.session_state.messages = [st.session_state.messages[0]]
        st.rerun()

# ══════════════════════════════════════════════════════════════════════════════
# TAB 4: IOT & ESP32 INTEGRATION
# ══════════════════════════════════════════════════════════════════════════════
with tab_iot:
    st.markdown("### ⚙️ ESP32 & IoT Sensor Integration Guide")
    st.markdown("""
    You can connect your ESP32 microcontrollers and DHT22 / Capacitive Soil Moisture sensors to this CropMonitor system.
    """)

    col_i1, col_i2 = st.columns(2)
    with col_i1:
        st.markdown("#### 📡 Direct REST Ingestion")
        st.markdown("""
        When running the Node backend or Streamlit server, the ESP32 posts JSON packets every 5–10 seconds:
        ```json
        {
          "moisture": 28.5,
          "temperature": 26.2,
          "humidity": 64.0
        }
        ```
        """)

        st.markdown("#### 💻 Quick PowerShell Simulation Command")
        st.code("""
# Simulate a dry soil reading from terminal:
Invoke-RestMethod -Uri "http://localhost:3000/api/sensor" -Method POST `
  -ContentType "application/json" `
  -Body '{"moisture": 18.0, "temperature": 32.5, "humidity": 45.0}'
        """, language="powershell")

    with col_i2:
        st.markdown("#### 🔌 ESP32 Wiring Quick Reference")
        st.markdown("""
        - **Soil Moisture AO** ➔ ESP32 GPIO 34 (ADC1)
        - **DHT22 DATA** ➔ ESP32 GPIO 4
        - **Relay IN** ➔ ESP32 GPIO 26
        - **VCC / GND** ➔ 3.3V / 5V and GND rail
        """)
        st.info("The ESP32 Arduino firmware is pre-configured and available in `CropMonitor/esp32/crop_monitor.ino`.")

# ── Footer ──────────────────────────────────────────────────────────────────
st.divider()
st.caption("🌿 CropMonitor AI • Powered by Google Gemini 1.5/3.5 Vision & IoT Telemetry • Deployable to Streamlit Community Cloud")
