# 🌿 CropMonitor AI

> AI-powered smart crop monitoring and automated irrigation system.

![Dashboard Preview](../frontend/preview.png)

## Features

| Feature | Description |
|---|---|
| 📷 **AI Crop Analysis** | Upload a photo → Gemini Vision detects diseases, pests & nutrient deficiencies |
| 💧 **Soil Moisture Monitor** | Real-time capacitive soil moisture readings from ESP32 |
| 🌡️ **Temperature & Humidity** | Live DHT22 sensor data displayed on dashboard |
| 🚿 **Auto Irrigation** | Pump turns ON/OFF automatically based on configurable moisture thresholds |
| 🖐 **Manual Override** | Control the pump manually from the dashboard |
| 📊 **24-Hour Charts** | Historical trend charts for all sensor readings |
| 🔔 **Alert System** | Instant alerts for critical moisture levels or high temperatures |
| 🔌 **WebSocket Live** | Dashboard updates in real-time with no page refresh needed |

---

## Project Structure

```
CropMonitor/
├── backend/
│   ├── server.js          ← Main Express + WebSocket server
│   ├── db.js              ← SQLite database layer
│   ├── routes/
│   │   ├── sensor.js      ← ESP32 data ingestion + auto-irrigation logic
│   │   ├── analyze.js     ← Gemini Vision AI crop analysis
│   │   └── irrigation.js  ← Manual pump override
│   ├── package.json
│   └── .env               ← Your config (API key, thresholds)
├── frontend/
│   ├── index.html         ← Dashboard UI
│   ├── style.css          ← Dark glassmorphism theme
│   └── app.js             ← WebSocket + chart + upload logic
└── esp32/
    └── crop_monitor.ino   ← Arduino firmware for ESP32
```

---

## Quick Start

### 1. Get a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com)
2. Click **Create API key**
3. Copy the key

### 2. Configure the Backend

Open `backend/.env` and add your key:

```env
GEMINI_API_KEY=your_actual_key_here
PORT=3000
MOISTURE_ON_THRESHOLD=30
MOISTURE_OFF_THRESHOLD=60
```

### 3. Start the Server

```powershell
cd CropMonitor\backend
npm start
```

Dashboard opens at: **http://localhost:3000**

### 4. Flash the ESP32

1. Open `esp32/crop_monitor.ino` in **Arduino IDE**
2. Install required libraries via Library Manager:
   - `DHT sensor library` by Adafruit
   - `ArduinoJson` by Benoit Blanchon (v6.x)
3. Edit the top of the file:
   ```cpp
   #define WIFI_SSID     "Your_WiFi_SSID"
   #define WIFI_PASSWORD "Your_WiFi_Password"
   #define SERVER_URL    "http://YOUR_PC_IP:3000/api/sensor"
   ```
   > Find your PC's IP: run `ipconfig` in PowerShell → look for IPv4 Address
4. Select board: **ESP32 Dev Module** → Upload

---

## Wiring Diagram

```
ESP32 GPIO 4  ──── DHT22 DATA
ESP32 3.3V    ──── DHT22 VCC (with 10kΩ pull-up to DATA)
ESP32 GND     ──── DHT22 GND

ESP32 GPIO 34 ──── Soil Moisture Sensor AO  
ESP32 3.3V    ──── Soil Moisture VCC
ESP32 GND     ──── Soil Moisture GND

ESP32 GPIO 26 ──── Relay IN
ESP32 5V      ──── Relay VCC
ESP32 GND     ──── Relay GND
Relay COM     ──── Pump power supply positive
Relay NO      ──── Pump motor positive terminal
```

> ⚠️ **Note**: Use GPIO 34 for soil sensor — it's input-only ADC1. Never use GPIO 35–39 for output. Power the pump with an external 5V/12V supply through the relay, NOT from ESP32's 3.3V pin.

---

## Soil Moisture Calibration

You'll need to calibrate the `SOIL_DRY_VALUE` and `SOIL_WET_VALUE` constants:

1. Open Serial Monitor at 115200 baud after flashing
2. Hold the sensor **in air** — note the ADC raw value → set as `SOIL_DRY_VALUE`
3. Submerge sensor tip **in water** — note the raw value → set as `SOIL_WET_VALUE`
4. Re-upload firmware

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/sensor` | ESP32 posts `{ moisture, temperature, humidity }` |
| `GET` | `/api/sensor/latest` | Latest sensor reading |
| `GET` | `/api/sensor/history` | Last 24h of readings |
| `POST` | `/api/analyze` | Multipart image → AI analysis |
| `GET` | `/api/analyze/history` | Last 10 AI analyses |
| `POST` | `/api/irrigation/override` | `{ mode: "auto"|"manual", pump_on: bool }` |
| `GET` | `/api/irrigation/status` | Current pump mode & state |
| `WS` | `ws://localhost:3000/ws` | Real-time updates |

---

## Testing Without Hardware

You can simulate ESP32 data using PowerShell:

```powershell
# Simulate a low-moisture reading (will trigger pump)
Invoke-RestMethod -Uri "http://localhost:3000/api/sensor" -Method POST `
  -ContentType "application/json" `
  -Body '{"moisture": 20, "temperature": 28.5, "humidity": 65}'

# Simulate normal reading
Invoke-RestMethod -Uri "http://localhost:3000/api/sensor" -Method POST `
  -ContentType "application/json" `
  -Body '{"moisture": 55, "temperature": 26.0, "humidity": 70}'
```

---

## Tech Stack

- **Frontend**: HTML5, Vanilla CSS (glassmorphism), JavaScript, Chart.js
- **Backend**: Node.js, Express, WebSocket (`ws`), SQLite (`better-sqlite3`)
- **AI**: Google Gemini 1.5 Flash Vision API
- **IoT**: ESP32 + DHT22 + Capacitive Soil Moisture Sensor + Relay Module
