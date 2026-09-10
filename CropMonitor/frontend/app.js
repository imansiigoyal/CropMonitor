'use strict';

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const WS_URL   = `ws://${location.host}/ws`;
const API      = '/api';
const MAX_PTS  = 60;

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────
let ws            = null;
let wsRetry       = 1500;
let chart         = null;
let activeChart   = 'moisture';
let selectedFile  = null;
let analysedSrc   = '';

const history = { labels:[], moisture:[], temperature:[], humidity:[] };

// ─────────────────────────────────────────────────────────────
// DOM helpers
// ─────────────────────────────────────────────────────────────
const $  = (id) => document.getElementById(id);
const el = (id) => $( id );

// ─────────────────────────────────────────────────────────────
// WebSocket
// ─────────────────────────────────────────────────────────────
function connectWS() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    const pill = $('ws-pill');
    pill.className = 'ws-pill live';
    $('ws-label').textContent = 'Live';
    wsRetry = 1500;
    // Fetch existing data on connect
    fetchLatest();
    fetchHistory();
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'sensor_update')     handleSensor(msg.data);
      if (msg.type === 'irrigation_update') handleIrrigation(msg.data);
    } catch {}
  };

  ws.onclose = () => {
    $('ws-pill').className = 'ws-pill';
    $('ws-label').textContent = 'Reconnecting…';
    setTimeout(connectWS, wsRetry);
    wsRetry = Math.min(wsRetry * 1.5, 12000);
  };

  ws.onerror = () => { ws.close(); };
}

// ─────────────────────────────────────────────────────────────
// Sensor update
// ─────────────────────────────────────────────────────────────
function handleSensor(d) {
  const { moisture, temperature, humidity, pump_on, mode,
          moisture_on_threshold: onT, moisture_off_threshold: offT,
          timestamp } = d;

  // Cards
  setCard('moisture',    moisture,    100, tempDesc(false, moisture));
  setCard('temp',        temperature, 50,  tempDesc(true,  temperature));
  setCard('humidity',    humidity,    100, humDesc(humidity));

  $('on-thresh').textContent  = onT  ?? 30;
  $('off-thresh').textContent = offT ?? 60;

  updatePump(pump_on, mode);

  $('updated-badge').textContent = 'Updated: ' + fmtTime(timestamp);

  // Sync with AgriBot mini telemetry bar
  const cm = $('chat-tele-moisture');
  const ct = $('chat-tele-temp');
  if (cm) cm.textContent = `${moisture.toFixed(1)}%`;
  if (ct) ct.textContent = `${temperature.toFixed(1)}°C`;

  // Chart history
  history.labels.push(fmtTime(timestamp));
  history.moisture.push(+moisture.toFixed(1));
  history.temperature.push(+temperature.toFixed(1));
  history.humidity.push(+humidity.toFixed(1));
  if (history.labels.length > MAX_PTS) {
    ['labels','moisture','temperature','humidity'].forEach(k => history[k].shift());
  }
  renderChart();

  // Alerts
  if (moisture < (onT ?? 30) - 10)
    showAlert(`🚨 Critical: Soil moisture very low (${moisture.toFixed(1)}%)! Pump should be ON.`, true);
  else if (temperature > 42)
    showAlert(`🌡️ Warning: Temperature is dangerously high (${temperature.toFixed(1)}°C).`);
}

function setCard(key, val, max, desc) {
  const vEl = $(`v-${key}`);
  const bEl = $(`b-${key}`);
  const sEl = $(`${key === 'temp' ? 'temp' : key}-status`);

  if (vEl) vEl.textContent = val.toFixed(1);
  if (bEl) bEl.style.width = Math.min((val / max) * 100, 100) + '%';
  if (sEl) sEl.textContent = desc;
}

function updatePump(on, mode) {
  const ring  = $('pump-ring');
  const txt   = $('pump-text');
  const lbl   = $('pump-mode-label');
  if (!ring) return;

  ring.className = 'pump-ring' + (on ? ' on' : '');
  txt.textContent = on ? 'ON' : 'OFF';
  if (lbl) lbl.textContent = `Mode: ${mode === 'manual' ? 'Manual' : 'Auto'}`;

  // Sync AgriBot mini telemetry bar pump
  const cp = $('chat-tele-pump');
  if (cp) cp.textContent = on ? 'ON 💦' : 'OFF ⛔';

  // Sync mode buttons
  $('btn-auto').classList.toggle('active',   mode !== 'manual');
  $('btn-manual').classList.toggle('active', mode === 'manual');
  const mb = $('manual-btns');
  if (mb) mb.classList.toggle('hidden', mode !== 'manual');
}

function handleIrrigation({ mode, pump_on }) {
  updatePump(pump_on, mode);
}

function tempDesc(isTemp, val) {
  if (isTemp) {
    if (val < 10)  return '🥶 Very cold';
    if (val < 18)  return '❄️ Cool';
    if (val < 28)  return '✅ Optimal';
    if (val < 36)  return '☀️ Warm';
    return '🔥 Very hot';
  }
  // moisture
  if (val < 20)  return '🏜️ Critically dry';
  if (val < 35)  return '⚠️ Low moisture';
  if (val < 65)  return '✅ Optimal range';
  return '💦 Well irrigated';
}

function humDesc(h) {
  if (h < 20)  return '🏜️ Very dry air';
  if (h < 40)  return '☀️ Dry';
  if (h < 70)  return '✅ Good humidity';
  if (h < 85)  return '💧 Humid';
  return '🌧️ Very humid';
}

// ─────────────────────────────────────────────────────────────
// REST fallbacks
// ─────────────────────────────────────────────────────────────
async function fetchLatest() {
  try {
    const r = await fetch(`${API}/sensor/latest`);
    const d = await r.json();
    if (d) handleSensor({
      moisture:               d.moisture,
      temperature:            d.temperature,
      humidity:               d.humidity,
      pump_on:                d.pump_state === 1,
      mode:                   d.mode ?? 'auto',
      moisture_on_threshold:  d.moisture_on_threshold  ?? 30,
      moisture_off_threshold: d.moisture_off_threshold ?? 60,
      timestamp:              d.timestamp ?? new Date().toISOString(),
    });
  } catch {}
}

async function fetchHistory() {
  try {
    const r    = await fetch(`${API}/sensor/history`);
    const rows = await r.json();
    if (!Array.isArray(rows)) return;
    rows.forEach(row => {
      history.labels.push(fmtTime(row.timestamp));
      history.moisture.push(row.moisture);
      history.temperature.push(row.temperature);
      history.humidity.push(row.humidity);
    });
    if (history.labels.length > MAX_PTS) {
      ['labels','moisture','temperature','humidity'].forEach(k => {
        history[k] = history[k].slice(-MAX_PTS);
      });
    }
    renderChart();
  } catch {}
}

// ─────────────────────────────────────────────────────────────
// Chart
// ─────────────────────────────────────────────────────────────
const CHART_CFG = {
  moisture:    { label: 'Soil Moisture (%)',  color: '#60a5fa' },
  temperature: { label: 'Temperature (°C)',   color: '#fbbf24' },
  humidity:    { label: 'Humidity (%)',        color: '#2dd4bf' },
};

function renderChart() {
  const cfg  = CHART_CFG[activeChart];
  const data = history[activeChart];

  if (!chart) {
    const ctx = $('main-chart').getContext('2d');
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: history.labels,
        datasets: [{
          label:           cfg.label,
          data,
          borderColor:     cfg.color,
          backgroundColor: cfg.color + '20',
          borderWidth:     2.5,
          pointRadius:     2,
          pointHoverRadius:5,
          fill:            true,
          tension:         0.4,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           { duration: 250 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(8,14,10,.95)',
            borderColor:     'rgba(255,255,255,.08)',
            borderWidth:     1,
            titleColor:      '#e8fdf0',
            bodyColor:       '#86efac',
            padding:         10,
          },
        },
        scales: {
          x: {
            ticks: { color:'#2a4535', maxTicksLimit:8, maxRotation:0, font:{ family:'JetBrains Mono', size:10 } },
            grid:  { color:'rgba(255,255,255,.03)' },
            border:{ color:'rgba(255,255,255,.05)' },
          },
          y: {
            ticks: { color:'#2a4535', font:{ family:'JetBrains Mono', size:10 } },
            grid:  { color:'rgba(255,255,255,.03)' },
            border:{ color:'rgba(255,255,255,.05)' },
          },
        },
      },
    });
    return;
  }

  // Update existing chart
  chart.data.labels              = history.labels;
  chart.data.datasets[0].data   = data;
  chart.data.datasets[0].label  = cfg.label;
  chart.data.datasets[0].borderColor     = cfg.color;
  chart.data.datasets[0].backgroundColor = cfg.color + '20';
  chart.update('none');
}

// Chart tab switching
document.querySelectorAll('.ctab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ctab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeChart = btn.dataset.key;
    if (chart) { chart.destroy(); chart = null; }
    renderChart();
  });
});

// ─────────────────────────────────────────────────────────────
// Irrigation controls
// ─────────────────────────────────────────────────────────────
window.setMode = async function(mode) {
  await sendOverride(mode, false);
};

window.sendOverride = async function(mode, pumpOn) {
  try {
    const r = await fetch(`${API}/irrigation/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, pump_on: pumpOn }),
    });
    const d = await r.json();
    updatePump(d.pump_on, d.mode);
  } catch (e) {
    showAlert('Could not send irrigation command. Is the server running?', true);
  }
};

// ─────────────────────────────────────────────────────────────
// File upload + AI analysis
// ─────────────────────────────────────────────────────────────
const uploadArea  = $('upload-area');
const fileInput   = $('file-input');
const previewBox  = $('preview-box');
const previewImg  = $('preview-img');
const previewName = $('preview-filename');
const btnAnalyse  = $('btn-analyse');
const btnClear    = $('btn-clear');
const aiLoading   = $('ai-loading');
const aiResults   = $('ai-results');
const aiError     = $('ai-error');

// Click to open file picker
uploadArea.addEventListener('click', () => fileInput.click());

// Drag and drop
uploadArea.addEventListener('dragover',  (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
uploadArea.addEventListener('dragleave', ()  =>  uploadArea.classList.remove('drag-over'));
uploadArea.addEventListener('drop',      (e) => {
  e.preventDefault();
  uploadArea.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) selectFile(f);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) selectFile(fileInput.files[0]);
});

function selectFile(f) {
  if (!f.type.startsWith('image/')) {
    showAlert('Please upload an image file (JPEG, PNG, WebP).', true);
    return;
  }
  selectedFile = f;
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    analysedSrc    = e.target.result;   // save for results panel
    previewName.textContent = f.name;
    previewBox.classList.remove('hidden');
    uploadArea.classList.add('hidden');
  };
  reader.readAsDataURL(f);
}

btnClear.addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = '';
  previewBox.classList.add('hidden');
  uploadArea.classList.remove('hidden');
  aiResults.classList.add('hidden');
  aiError.classList.add('hidden');
});

// ── The analyse button ──
btnAnalyse.addEventListener('click', async () => {
  if (!selectedFile) return;

  // Show loading, hide others
  previewBox.classList.add('hidden');
  uploadArea.classList.add('hidden');
  aiLoading.classList.remove('hidden');
  aiResults.classList.add('hidden');
  aiError.classList.add('hidden');

  try {
    const form = new FormData();
    form.append('image', selectedFile);

    const res = await fetch(`${API}/analyze`, {
      method: 'POST',
      body:   form,
    });

    const json = await res.json();

    if (!res.ok) {
      throw new Error(json.error || `Server error ${res.status}`);
    }

    aiLoading.classList.add('hidden');
    showResults(json);

  } catch (err) {
    aiLoading.classList.add('hidden');
    showError(err.message);
  }
});

// ─────────────────────────────────────────────────────────────
// Render AI Results
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// Render AI Results
// ─────────────────────────────────────────────────────────────
function showResults(a) {
  aiResults.classList.remove('hidden');

  // Health score ring
  const score   = a.health_score ?? 0;
  const circ    = 2 * Math.PI * 50;   // r=50 → 314.16
  const dash    = (score / 100) * circ;
  $('hring-fg').setAttribute('stroke-dasharray', `${dash.toFixed(2)} ${circ.toFixed(2)}`);
  $('ring-num').textContent = score;

  // Ring colour
  const cls = (a.overall_health ?? 'fair').toLowerCase();
  $('hring-fg').style.stroke = cls === 'good' ? '#4ade80' : cls === 'fair' ? '#fbbf24' : '#f87171';

  // Text
  const hv = $('health-value');
  hv.textContent = `${healthEmoji(a.overall_health)} ${a.overall_health ?? 'Unknown'}`;
  hv.className = `health-value health-${cls}`;
  $('urgency-pill').textContent = `Urgency: ${a.urgency ?? 'Routine monitoring'}`;

  // Crop Identity & Stage
  const cropTitle = $('crop-name-title');
  const cropSci   = $('crop-sci-name');
  const cropStage = $('crop-stage-val');
  const cropVisual = $('crop-visual-text');

  if (cropTitle) cropTitle.textContent = a.crop_name || 'Detected Crop';
  if (cropSci)   cropSci.textContent   = a.scientific_name ? `(${a.scientific_name})` : '';
  if (cropStage) cropStage.textContent = a.growth_stage || 'Active Growth Stage';
  if (cropVisual) cropVisual.textContent = a.visual_assessment || 'Visual canopy assessment completed.';

  // Analysed image
  $('analysed-img').src = analysedSrc;

  // Diseases & Health Watch
  $('disease-content').innerHTML = renderItems(a.diseases ?? [], renderDisease);
  // Pests & Threat Watch
  $('pest-content').innerHTML    = renderItems(a.pests ?? [], renderPest);
  // Nutrients & Soil
  $('nutrient-content').innerHTML = renderItems(a.nutrient_deficiency ?? [], renderNutrient);
  // Soil & Irrigation Guide
  const soilEl = $('soil-content');
  if (soilEl) {
    soilEl.innerHTML = a.soil_irrigation_guide
      ? `<div class="result-item"><div class="ri-head"><span class="ri-name">💧 Stage-Specific Irrigation & Soil Guide</span></div><div class="ri-body">${a.soil_irrigation_guide}</div></div>`
      : `<div class="no-issue">💧 Standard irrigation schedule recommended for this crop.</div>`;
  }
  // Recs & Action Plan
  const recs = a.recommendations ?? [];
  $('recs-content').innerHTML = recs.length
    ? `<ul class="recs-list">${recs.map(r => `<li>→ ${r}</li>`).join('')}</ul>`
    : '<div class="no-issue">✅ Follow routine crop monitoring.</div>';

  // Switch to diseases tab
  switchResultTab('tab-diseases');
}

function renderItems(arr, fn) {
  if (!arr.length) return '<div class="no-issue">✅ No acute symptoms detected. Continue preventive monitoring.</div>';
  return arr.map(fn).join('');
}

function renderDisease(d) {
  const conf = (d.confidence ?? 'Low').toLowerCase();
  const isWatch = (d.status ?? '').toLowerCase().includes('watch');
  const statusBadge = isWatch
    ? `<span class="ri-badge badge-watch">🛡️ ${d.status || 'Preventive Watch'}</span>`
    : `<span class="ri-badge badge-high">⚠️ ${d.status || 'Active Infection'}</span>`;

  return `<div class="result-item ${isWatch ? 'item-watch' : 'item-active'}">
    <div class="ri-head">
      <span class="ri-name">🦠 ${d.name}</span>
      <div style="display:flex;gap:.4rem;align-items:center;">
        ${statusBadge}
        <span class="ri-badge badge-${conf}">${d.confidence || 'Medium'} Confidence</span>
      </div>
    </div>
    <div class="ri-body">
      <strong>Affected area / Target:</strong> ${d.affected_area ?? 'Foliage'}<br>
      <strong>Treatment / Prevention:</strong> ${d.treatment ?? 'N/A'}
    </div>
  </div>`;
}

function renderPest(p) {
  const risk = (p.risk_level ?? 'Low').toLowerCase();
  const isWatch = (p.status ?? '').toLowerCase().includes('watch');
  const statusBadge = isWatch
    ? `<span class="ri-badge badge-watch">🛡️ ${p.status || 'Common Threat Watch'}</span>`
    : `<span class="ri-badge badge-high">🚨 ${p.status || 'Active Infestation'}</span>`;

  return `<div class="result-item ${isWatch ? 'item-watch' : 'item-active'}">
    <div class="ri-head">
      <span class="ri-name">🐛 ${p.name}</span>
      <div style="display:flex;gap:.4rem;align-items:center;">
        ${statusBadge}
        <span class="ri-badge badge-${risk}">${p.risk_level || 'Medium'} Risk</span>
      </div>
    </div>
    <div class="ri-body">
      <strong>Signs to inspect:</strong> ${p.signs ?? 'N/A'}<br>
      <strong>Control / Spray Guidance:</strong> ${p.control ?? 'N/A'}
    </div>
  </div>`;
}

function renderNutrient(n) {
  return `<div class="result-item">
    <div class="ri-head"><span class="ri-name">🧪 ${n.type}</span></div>
    <div class="ri-body">
      <strong>Symptoms / Requirements:</strong> ${n.symptoms ?? 'N/A'}<br>
      <strong>Remedy / Fertilizer:</strong> ${n.remedy ?? 'N/A'}
    </div>
  </div>`;
}

function healthEmoji(h) {
  return { Good:'💚', Fair:'💛', Poor:'🟠', Critical:'🔴' }[h] ?? '⚪';
}

// Result tab switching
document.querySelectorAll('.rtab').forEach(btn => {
  btn.addEventListener('click', () => switchResultTab(btn.dataset.target));
});

function switchResultTab(id) {
  document.querySelectorAll('.rtab').forEach(b => {
    b.classList.toggle('active', b.dataset.target === id);
  });
  document.querySelectorAll('.result-panel').forEach(p => {
    p.classList.toggle('active', p.id === id);
  });
}

// Re-analyse button
$('btn-reanalyse').addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = '';
  aiResults.classList.add('hidden');
  uploadArea.classList.remove('hidden');
  previewBox.classList.add('hidden');
});

// ─────────────────────────────────────────────────────────────
// Error display
// ─────────────────────────────────────────────────────────────
function showError(msg) {
  aiError.classList.remove('hidden');
  $('error-msg').textContent = msg;
  uploadArea.classList.remove('hidden');
}

$('btn-retry').addEventListener('click', () => {
  aiError.classList.add('hidden');
  if (selectedFile) {
    previewBox.classList.remove('hidden');
    uploadArea.classList.add('hidden');
  }
});

// ─────────────────────────────────────────────────────────────
// Alert bar
// ─────────────────────────────────────────────────────────────
let alertTimer = null;
function showAlert(msg, critical = false) {
  const bar = $('alert-bar');
  $('alert-text').textContent = msg;
  bar.className = `alert-bar${critical ? ' crit' : ''}`;
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => bar.classList.add('hidden'), 9000);
}
$('alert-close').addEventListener('click', () => $('alert-bar').classList.add('hidden'));

// ─────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────
function fmtTime(ts) {
  if (!ts) return '--';
  try {
    return new Date(ts).toLocaleTimeString('en-IN', {
      hour:'2-digit', minute:'2-digit', second:'2-digit'
    });
  } catch { return '--'; }
}

// ─────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────
connectWS();

// ─────────────────────────────────────────────────────────────
// 🤖 AGRIBOT AI CHATBOT CONTROLLER
// ─────────────────────────────────────────────────────────────
(function initAgriBotController() {
  const panel        = $('agribot-panel');
  const launcher     = $('agribot-launcher');
  const toggleBtn    = $('agribot-toggle-btn');
  const launcherPill = $('agribot-launcher-pill');
  const topbarBtn    = $('topbar-chat-btn');
  const closeBtn     = $('agribot-close-btn');
  const clearBtn     = $('agribot-clear-btn');
  const messagesBox  = $('agribot-messages');
  const typingEl     = $('agribot-typing');
  const formEl       = $('agribot-form');
  const inputEl      = $('agribot-input');
  const sendBtn      = $('agribot-send-btn');
  const btnIcon      = $('agribot-btn-icon');
  const chipsBar     = $('agribot-chips');

  if (!panel || !toggleBtn || !formEl || !inputEl) return;

  let isChatOpen = false;
  let isThinking = false;
  let chatHistory = [];

  // Default welcome message
  const WELCOME_MSG = {
    role: 'model',
    content: `Hello! I am **AgriBot AI**, your smart agronomy & farm irrigation advisor 🌿\n\nI am continuously monitoring your **live IoT sensors** (soil moisture, temperature, humidity, pump) and crop disease scans.\n\nAsk me anything like:\n* *"Should I water my crops right now?"*\n* *"Are my humidity and temperature levels optimal?"*\n* *"What are organic remedies for aphids or blight?"*\n* *"How can I improve soil nutrient retention?"*`,
    timestamp: new Date().toISOString(),
  };

  // ── Open / Close Chat Window ──────────────────────────────
  function toggleChat(forceOpen) {
    isChatOpen = typeof forceOpen === 'boolean' ? forceOpen : !isChatOpen;
    panel.classList.toggle('hidden', !isChatOpen);

    if (btnIcon) {
      btnIcon.textContent = isChatOpen ? '✕' : '💬';
    }

    if (isChatOpen) {
      scrollChatBottom();
      setTimeout(() => inputEl.focus(), 150);
    }
  }

  toggleBtn.addEventListener('click', () => toggleChat());
  if (launcherPill) launcherPill.addEventListener('click', () => toggleChat(true));
  if (topbarBtn)    topbarBtn.addEventListener('click', () => toggleChat(true));
  if (closeBtn)     closeBtn.addEventListener('click', () => toggleChat(false));

  // ── Auto-resize input textarea ─────────────────────────────
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
  });

  // Enter to send (Shift+Enter for newline)
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      formEl.dispatchEvent(new Event('submit'));
    }
  });

  // ── Quick Prompt Chips ────────────────────────────────────
  if (chipsBar) {
    chipsBar.querySelectorAll('.agri-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const promptText = chip.getAttribute('data-prompt');
        if (promptText && !isThinking) {
          submitQuestion(promptText);
        }
      });
    });
  }

  // ── Form Submit ───────────────────────────────────────────
  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text || isThinking) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';
    submitQuestion(text);
  });

  // ── Submit User Question to Backend ───────────────────────
  async function submitQuestion(questionText) {
    // Render user message
    const userMsg = {
      role: 'user',
      content: questionText,
      timestamp: new Date().toISOString(),
    };
    renderMessage(userMsg);
    chatHistory.push(userMsg);
    scrollChatBottom();

    // Show typing state
    setThinking(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: questionText,
          history: chatHistory.slice(-10).map((m) => ({
            role: m.role === 'user' ? 'user' : 'model',
            content: m.content,
          })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Server responded with status ${res.status}`);
      }

      const botMsg = {
        role: 'model',
        content: data.reply || 'No response received.',
        timestamp: data.timestamp || new Date().toISOString(),
      };
      renderMessage(botMsg);
      chatHistory.push(botMsg);

    } catch (err) {
      console.error('[AgriBot Error]', err);
      const errMsg = {
        role: 'model',
        content: `⚠️ **AgriBot Assistant:** ${err.message || 'Unable to connect to AI service. Please check your network or try again.'}`,
        timestamp: new Date().toISOString(),
      };
      renderMessage(errMsg);
    } finally {
      setThinking(false);
      scrollChatBottom();
    }
  }

  function setThinking(active) {
    isThinking = active;
    typingEl.classList.toggle('hidden', !active);
    sendBtn.disabled = active;
    if (active) scrollChatBottom();
  }

  function scrollChatBottom() {
    requestAnimationFrame(() => {
      messagesBox.scrollTop = messagesBox.scrollHeight;
    });
  }

  // ── Render Message Bubble ─────────────────────────────────
  function renderMessage(msg) {
    const isBot = msg.role === 'model' || msg.role === 'assistant';
    const msgEl = document.createElement('div');
    msgEl.className = `chat-msg ${isBot ? 'bot' : 'user'}`;

    const timeStr = fmtTime(msg.timestamp);

    const avatarHtml = isBot
      ? `<div class="chat-avatar">🌿</div>`
      : `<div class="chat-avatar">🧑‍🌾</div>`;

    const formattedContent = isBot ? formatMarkdown(msg.content) : escapeHtml(msg.content);

    msgEl.innerHTML = `
      ${avatarHtml}
      <div>
        <div class="chat-bubble">
          ${formattedContent}
        </div>
        <div class="chat-time">${timeStr}</div>
      </div>
    `;

    messagesBox.appendChild(msgEl);
  }

  // ── Simple, robust Markdown parser for Bot bubbles ────────
  function formatMarkdown(text) {
    if (!text) return '';
    let escaped = escapeHtml(text);

    // Code blocks ```code```
    escaped = escaped.replace(/```([\s\S]*?)```/g, (_, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Inline code `code`
    escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers
    escaped = escaped.replace(/^### (.*$)/gim, '<h4>$1</h4>');
    escaped = escaped.replace(/^## (.*$)/gim, '<h3>$1</h3>');

    // Bold **text** or __text__
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/__(.*?)__/g, '<strong>$1</strong>');

    // Italic *text* or _text_
    escaped = escaped.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

    // Bullet points * or -
    const lines = escaped.split('\n');
    let inList = false;
    const formattedLines = [];

    for (let line of lines) {
      const trimmed = line.trim();
      if (/^[\*\-]\s+(.*)/.test(trimmed)) {
        if (!inList) {
          formattedLines.push('<ul>');
          inList = true;
        }
        formattedLines.push(`<li>${trimmed.replace(/^[\*\-]\s+/, '')}</li>`);
      } else if (/^\d+\.\s+(.*)/.test(trimmed)) {
        if (!inList) {
          formattedLines.push('<ol>');
          inList = 'ol';
        }
        formattedLines.push(`<li>${trimmed.replace(/^\d+\.\s+/, '')}</li>`);
      } else {
        if (inList) {
          formattedLines.push(inList === 'ol' ? '</ol>' : '</ul>');
          inList = false;
        }
        if (trimmed) {
          formattedLines.push(`<p>${trimmed}</p>`);
        }
      }
    }
    if (inList) {
      formattedLines.push(inList === 'ol' ? '</ol>' : '</ul>');
    }

    return formattedLines.join('');
  }

  function escapeHtml(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, (m) => map[m]);
  }

  // ── Load Chat History ─────────────────────────────────────
  async function loadHistory() {
    try {
      const res = await fetch('/api/chat/history?limit=25');
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0) {
          messagesBox.innerHTML = '';
          chatHistory = rows.map((r) => ({
            role: r.role,
            content: r.content,
            timestamp: r.timestamp,
          }));
          chatHistory.forEach(renderMessage);
          scrollChatBottom();
          return;
        }
      }
    } catch {}

    // Fallback: render welcome message
    messagesBox.innerHTML = '';
    renderMessage(WELCOME_MSG);
    chatHistory = [WELCOME_MSG];
  }

  // ── Clear Chat History ────────────────────────────────────
  clearBtn.addEventListener('click', async () => {
    if (!confirm('Clear all AgriBot chat messages?')) return;
    try {
      await fetch('/api/chat/history', { method: 'DELETE' });
    } catch {}
    messagesBox.innerHTML = '';
    renderMessage(WELCOME_MSG);
    chatHistory = [WELCOME_MSG];
  });

  // Initial load
  loadHistory();
})();

