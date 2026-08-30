/*
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║    CropMonitor AI — ESP32 Firmware                           ║
 * ║    Sensors: DHT22 (Temp + Humidity) + Soil Moisture          ║
 * ║    Actuator: Relay module → Irrigation pump                  ║
 * ║    Protocol: Wi-Fi → HTTP POST JSON to backend               ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Wiring:
 *   DHT22  DATA pin  → GPIO 4
 *   Soil Moisture AO → GPIO 34  (ADC1_CH6, must be ADC1)
 *   Relay IN         → GPIO 26  (LOW = pump ON for active-low relays)
 *
 * Libraries needed (install via Arduino Library Manager):
 *   - DHT sensor library by Adafruit
 *   - Adafruit Unified Sensor
 *   - ArduinoJson  (version 6.x)
 *   - WiFi  (built-in for ESP32)
 *   - HTTPClient (built-in for ESP32)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <ArduinoJson.h>

// ── Wi-Fi credentials ──────────────────────────────────────────
#define WIFI_SSID     "Your_WiFi_SSID"
#define WIFI_PASSWORD "Your_WiFi_Password"

// ── Backend server ─────────────────────────────────────────────
// Replace with your PC's local IP address (run `ipconfig` to find it)
// Example: "http://192.168.1.100:3000/api/sensor"
#define SERVER_URL    "http://192.168.1.100:3000/api/sensor"

// ── GPIO pin definitions ───────────────────────────────────────
#define DHT_PIN       4       // DHT22 data pin
#define DHT_TYPE      DHT22
#define SOIL_PIN      34      // Capacitive soil moisture sensor AO → ADC
#define RELAY_PIN     26      // Relay IN pin (active-low)

// ── Soil moisture calibration ──────────────────────────────────
// Read raw ADC with sensor IN AIR  → set as DRY_VALUE  (~3200–3800)
// Read raw ADC with sensor IN WATER → set as WET_VALUE (~1000–1500)
// Adjust these values for your specific sensor
#define SOIL_DRY_VALUE  3200
#define SOIL_WET_VALUE  1100

// ── Timing ────────────────────────────────────────────────────
#define SEND_INTERVAL_MS  5000    // Send data every 5 seconds
#define DHT_READ_DELAY_MS 2500    // DHT22 minimum read interval

// ── Global objects ─────────────────────────────────────────────
DHT dht(DHT_PIN, DHT_TYPE);

unsigned long lastSendTime = 0;

// ── Setup ──────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n🌿 CropMonitor AI — ESP32 Firmware Starting...");

  // Pin modes
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH);  // Active-low: HIGH = pump OFF initially

  // Start DHT sensor
  dht.begin();
  delay(DHT_READ_DELAY_MS);

  // Connect to Wi-Fi
  connectWiFi();
}

// ── Main Loop ──────────────────────────────────────────────────
void loop() {
  // Reconnect Wi-Fi if dropped
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️  Wi-Fi lost. Reconnecting...");
    connectWiFi();
  }

  unsigned long now = millis();
  if (now - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = now;
    sendSensorData();
  }
}

// ── Wi-Fi Connection ───────────────────────────────────────────
void connectWiFi() {
  Serial.printf("📡 Connecting to Wi-Fi: %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 30) {
    delay(500);
    Serial.print(".");
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n✅ Connected! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n❌ Wi-Fi connection failed. Will retry in next cycle.");
  }
}

// ── Read Soil Moisture (0–100%) ────────────────────────────────
float readSoilMoisture() {
  // Average multiple readings to reduce ADC noise
  long sum = 0;
  const int SAMPLES = 10;
  for (int i = 0; i < SAMPLES; i++) {
    sum += analogRead(SOIL_PIN);
    delay(5);
  }
  int raw = sum / SAMPLES;

  // Map raw ADC to 0–100% moisture
  // DRY_VALUE = 0% moisture, WET_VALUE = 100% moisture
  float moisture = map(raw, SOIL_DRY_VALUE, SOIL_WET_VALUE, 0, 100);
  moisture = constrain(moisture, 0.0, 100.0);

  Serial.printf("   Soil ADC raw: %d → Moisture: %.1f%%\n", raw, moisture);
  return moisture;
}

// ── Apply Pump Command ─────────────────────────────────────────
void applyPumpState(bool pumpOn) {
  // Active-low relay: LOW = relay energised = pump ON
  digitalWrite(RELAY_PIN, pumpOn ? LOW : HIGH);
  Serial.printf("   💧 Pump: %s\n", pumpOn ? "ON" : "OFF");
}

// ── Send Sensor Data to Backend ────────────────────────────────
void sendSensorData() {
  // Read DHT22
  float temperature = dht.readTemperature();  // Celsius
  float humidity    = dht.readHumidity();

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("⚠️  DHT22 read failed. Check wiring.");
    return;
  }

  // Read soil moisture
  float moisture = readSoilMoisture();

  Serial.printf("\n📊 Sensor Reading:\n");
  Serial.printf("   Temperature: %.1f°C\n", temperature);
  Serial.printf("   Humidity:    %.1f%%\n",  humidity);
  Serial.printf("   Moisture:    %.1f%%\n",  moisture);

  // Build JSON payload
  StaticJsonDocument<256> doc;
  doc["temperature"] = round(temperature * 10) / 10.0;
  doc["humidity"]    = round(humidity    * 10) / 10.0;
  doc["moisture"]    = round(moisture    * 10) / 10.0;

  char payload[256];
  serializeJson(doc, payload);

  // Send HTTP POST
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️  Not connected. Skipping POST.");
    return;
  }

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000);  // 5 second timeout

  int responseCode = http.POST(payload);

  if (responseCode == 200) {
    String responseBody = http.getString();
    Serial.printf("✅ Server response (%d): %s\n", responseCode, responseBody.c_str());

    // Parse pump command from server response
    StaticJsonDocument<128> responseDoc;
    DeserializationError err = deserializeJson(responseDoc, responseBody);

    if (!err && responseDoc.containsKey("pump_on")) {
      bool pumpOn = responseDoc["pump_on"].as<bool>();
      applyPumpState(pumpOn);
    }
  } else {
    Serial.printf("❌ HTTP POST failed. Code: %d\n", responseCode);
  }

  http.end();
}
