// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────
function fmtTime(ts) {
  if (!ts) return '--';
  try {
    return new Date(ts).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch { return '--'; }
}

// For chart labels — only HH:MM to keep axis clean
function fmtChartTime(ts) {
  if (!ts) return '--';
  try {
    return new Date(ts).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return '--'; }
}

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
  $('urgency-pill').textContent = `Urgency: ${a.urgency ?? 'Unknown'}`;

  // Analysed image
  $('analysed-img').src = analysedSrc;

  // Diseases
  $('disease-content').innerHTML = renderItems(a.diseases ?? [], renderDisease);
  // Pests
  $('pest-content').innerHTML    = renderItems(a.pests ?? [], renderPest);
  // Nutrients
  $('nutrient-content').innerHTML = renderItems(a.nutrient_deficiency ?? [], renderNutrient);
  // Recs
  const recs = a.recommendations ?? [];
  $('recs-content').innerHTML = recs.length
    ? `<ul class="recs-list">${recs.map(r => `<li>→ ${r}</li>`).join('')}</ul>`
    : '<div class="no-issue">✅ No specific recommendations.</div>';

  // Switch to diseases tab
  switchResultTab('tab-diseases');
}

function renderItems(arr, fn) {
  if (!arr.length) return '<div class="no-issue">✅ None detected</div>';
  return arr.map(fn).join('');
}

function renderDisease(d) {
  const conf = (d.confidence ?? 'Low').toLowerCase();
  return `<div class="result-item">
    <div class="ri-head">
      <span class="ri-name">🦠 ${d.name}</span>
      <span class="ri-badge badge-${conf}">${d.confidence} Confidence</span>
    </div>
    <div class="ri-body">
      <strong>Affected area:</strong> ${d.affected_area ?? 'N/A'}<br>
      <strong>Treatment:</strong> ${d.treatment ?? 'N/A'}
    </div>
  </div>`;
}

function renderPest(p) {
  const risk = (p.risk_level ?? 'Low').toLowerCase();
  return `<div class="result-item">
    <div class="ri-head">
      <span class="ri-name">🐛 ${p.name}</span>
      <span class="ri-badge badge-${risk}">${p.risk_level} Risk</span>
    </div>
    <div class="ri-body">
      <strong>Signs:</strong> ${p.signs ?? 'N/A'}<br>
      <strong>Control:</strong> ${p.control ?? 'N/A'}
    </div>
  </div>`;
}

function renderNutrient(n) {
  return `<div class="result-item">
    <div class="ri-head"><span class="ri-name">🧪 ${n.type} Deficiency</span></div>
    <div class="ri-body">
      <strong>Symptoms:</strong> ${n.symptoms ?? 'N/A'}<br>
      <strong>Remedy:</strong> ${n.remedy ?? 'N/A'}
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
