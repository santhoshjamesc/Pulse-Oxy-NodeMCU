#include <Wire.h>
#include <U8g2lib.h>
#include <MAX30105.h>
#include <spo2_algorithm.h>
#include <ESP8266WiFi.h>
#include <WiFiManager.h>
#include <ESP8266WebServer.h>
#include <ArduinoJson.h>

// ── Sensor config ─────────────────────────────────────────────────────────────
#define IR_FINGER_THRESHOLD 50000UL
#define TOTAL_SAMPLES 5
const int sampleCounts[TOTAL_SAMPLES] = { 50, 60, 70, 80, 90 };
#define MAX_BUFFER 90

// ── Display refresh interval (ms) — don't redraw OLED more than this ─────────
#define DISPLAY_INTERVAL 500

// ── Objects ───────────────────────────────────────────────────────────────────
U8G2_SSD1306_128X64_NONAME_1_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE, D1, D2);
MAX30105 sensor;
ESP8266WebServer server(80);

// ── Sensor buffers ────────────────────────────────────────────────────────────
uint32_t irBuffer[MAX_BUFFER];
uint32_t redBuffer[MAX_BUFFER];

int32_t spo2      = 0;
int32_t heartRate = 0;
int8_t  spo2Valid = 0;
int8_t  hrValid   = 0;

float hrReadings[TOTAL_SAMPLES];
float spo2Readings[TOTAL_SAMPLES];
int   validHRCount   = 0;
int   validSpO2Count = 0;

float avgHR   = 0;
float avgSpO2 = 0;

bool running         = false;
bool hadFinger       = false;
bool cancelRequested = false;

char statusMsg[32]   = "Ready";
char patientName[32] = "";

// ── Display throttle ──────────────────────────────────────────────────────────
unsigned long lastDisplayMs = 0;

// ── Yield helper: call handleClient repeatedly for `ms` milliseconds ─────────
void yieldFor(unsigned long ms) {
  unsigned long start = millis();
  while (millis() - start < ms) {
    server.handleClient();
    yield();               // feeds ESP8266 watchdog
    delay(1);
  }
}

// ── Throttled display: only redraws if enough time has passed ─────────────────
bool shouldRedisplay() {
  unsigned long now = millis();
  if (now - lastDisplayMs >= DISPLAY_INTERVAL) {
    lastDisplayMs = now;
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CORS
// ═══════════════════════════════════════════════════════════════════════════════

void addCORS() {
  server.sendHeader("Access-Control-Allow-Origin",  "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void handleOptions() {
  addCORS();
  server.send(204);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WEB SERVER HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

void handleStart() {
  addCORS();
  if (!running) {
    patientName[0] = '\0';
    if (server.hasArg("plain")) {
      StaticJsonDocument<128> doc;
      DeserializationError err = deserializeJson(doc, server.arg("plain"));
      if (!err && doc.containsKey("name")) {
        strlcpy(patientName, doc["name"] | "", sizeof(patientName));
      }
    }

    running         = true;
    hadFinger       = false;
    cancelRequested = false;
    validHRCount    = 0;
    validSpO2Count  = 0;
    avgHR           = 0;
    avgSpO2         = 0;
    memset(hrReadings,   0, sizeof(hrReadings));
    memset(spo2Readings, 0, sizeof(spo2Readings));
    snprintf(statusMsg, sizeof(statusMsg), "Starting...");

    Serial.print("Start requested");
    if (strlen(patientName) > 0) { Serial.print(" for: "); Serial.println(patientName); }
    else Serial.println();
  }
  server.send(200, "application/json", "{\"ok\":true}");
}

void handleCancel() {
  addCORS();
  cancelRequested = true;
  Serial.println("Cancel requested");
  server.send(200, "application/json", "{\"ok\":true}");
}

void handleJSON() {
  addCORS();

  String status;
  if (!running && avgHR == 0 && avgSpO2 == 0) {
    status = "idle";
  } else if (running) {
    status = "measuring";
  } else {
    if (avgSpO2 >= 95 && avgHR >= 60 && avgHR <= 100) status = "Normal";
    else if (avgSpO2 >= 90)                             status = "Warning";
    else                                                status = "Critical";
  }

  String json = "{";
  json += "\"heartRate\":"    + String((int)avgHR)       + ",";
  json += "\"spo2\":"         + String((int)avgSpO2)     + ",";
  json += "\"hrValid\":"      + String(validHRCount)     + ",";
  json += "\"spo2Valid\":"    + String(validSpO2Count)   + ",";
  json += "\"totalSamples\":" + String(TOTAL_SAMPLES)    + ",";
  json += "\"running\":"      + String(running ? "true" : "false") + ",";
  json += "\"status\":\""     + status + "\"";
  json += "}";

  server.send(200, "application/json", json);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  OLED HELPERS  (unchanged visually)
// ═══════════════════════════════════════════════════════════════════════════════

void drawStatusBar() {
  u8g2.drawHLine(0, 54, 128);
  u8g2.setFont(u8g2_font_ncenB08_tr);
  u8g2.drawStr(0, 64, statusMsg);
}

void displayIdle() {
  snprintf(statusMsg, sizeof(statusMsg), "Idle");
  u8g2.firstPage();
  do {
    u8g2.setFont(u8g2_font_ncenB10_tr);
    u8g2.drawStr(0, 14, "Pulse Oximeter");
    u8g2.setFont(u8g2_font_ncenB08_tr);
    u8g2.drawStr(0, 30, "Waiting...");
    String ip = WiFi.localIP().toString();
    u8g2.drawStr(0, 46, ip.c_str());
    drawStatusBar();
  } while (u8g2.nextPage());
}

void displayGreeting() {
  snprintf(statusMsg, sizeof(statusMsg), "Ready");
  u8g2.firstPage();
  do {
    u8g2.setFont(u8g2_font_ncenB08_tr);
    if (strlen(patientName) > 0) {
      char line[40];
      snprintf(line, sizeof(line), "Hi, %s!", patientName);
      u8g2.drawStr(0, 12, line);
    } else {
      u8g2.drawStr(0, 12, "Hello!");
    }
    u8g2.drawHLine(0, 16, 128);
    u8g2.setFont(u8g2_font_ncenB10_tr);
    u8g2.drawStr(0, 32, "Keep finger");
    u8g2.drawStr(0, 48, "still...");
    drawStatusBar();
  } while (u8g2.nextPage());
}

void displayNoFinger() {
  snprintf(statusMsg, sizeof(statusMsg), "No finger");
  u8g2.firstPage();
  do {
    u8g2.setFont(u8g2_font_ncenB08_tr);
    if (strlen(patientName) > 0) {
      char line[40];
      snprintf(line, sizeof(line), "Hi, %s!", patientName);
      u8g2.drawStr(0, 12, line);
      u8g2.drawHLine(0, 16, 128);
      u8g2.setFont(u8g2_font_ncenB10_tr);
      u8g2.drawStr(0, 32, "Place finger");
      u8g2.drawStr(0, 48, "on sensor");
    } else {
      u8g2.setFont(u8g2_font_ncenB10_tr);
      u8g2.drawStr(0, 20, "Place finger");
      u8g2.drawStr(0, 38, "on sensor");
    }
    drawStatusBar();
  } while (u8g2.nextPage());
}

void displaySampling(int current, int total) {
  snprintf(statusMsg, sizeof(statusMsg), "Sample %d of %d", current, total);
  u8g2.firstPage();
  do {
    u8g2.setFont(u8g2_font_ncenB10_tr);
    u8g2.drawStr(0, 14, "Measuring...");
    u8g2.drawFrame(0, 22, 128, 12);
    int fillWidth = (int)((128.0f * current) / total);
    u8g2.drawBox(0, 22, fillWidth, 12);
    u8g2.setFont(u8g2_font_ncenB08_tr);
    if (current > 1) {
      u8g2.setCursor(0, 48);
      u8g2.print("HR:");
      u8g2.print((int)hrReadings[current - 2]);
      u8g2.setCursor(64, 48);
      u8g2.print("SpO2:");
      u8g2.print((int)spo2Readings[current - 2]);
    }
    drawStatusBar();
  } while (u8g2.nextPage());
}

void displayResults() {
  String statusLabel;
  if (avgSpO2 >= 95 && avgHR >= 60 && avgHR <= 100) statusLabel = "Normal";
  else if (avgSpO2 >= 90)                             statusLabel = "Warning";
  else                                                statusLabel = "Critical";

  snprintf(statusMsg, sizeof(statusMsg), "%s", statusLabel.c_str());

  u8g2.firstPage();
  do {
    u8g2.setFont(u8g2_font_ncenB08_tr);
    if (strlen(patientName) > 0) {
      char nameLine[40];
      snprintf(nameLine, sizeof(nameLine), "%s - Result", patientName);
      u8g2.drawStr(0, 10, nameLine);
    } else {
      u8g2.drawStr(0, 10, "Result");
    }
    u8g2.drawHLine(0, 13, 128);

    u8g2.setFont(u8g2_font_ncenB10_tr);
    u8g2.drawStr(0, 28, "HR:");
    u8g2.setCursor(36, 28);
    if (avgHR > 0) { u8g2.print((int)avgHR); u8g2.print(" bpm"); }
    else             u8g2.print("--");

    u8g2.drawStr(0, 46, "SpO2:");
    u8g2.setCursor(52, 46);
    if (avgSpO2 > 0) { u8g2.print((int)avgSpO2); u8g2.print(" %"); }
    else              u8g2.print("--");

    drawStatusBar();
  } while (u8g2.nextPage());
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SENSOR HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

bool fingerPresent() {
  return sensor.getIR() > IR_FINGER_THRESHOLD;
}

void resetMeasurement() {
  running         = false;
  hadFinger       = false;
  cancelRequested = false;
  validHRCount    = 0;
  validSpO2Count  = 0;
  patientName[0]  = '\0';
  snprintf(statusMsg, sizeof(statusMsg), "Cancelled");
  Serial.println("Measurement cancelled");
}

bool interruptibleCountdown(int seconds) {
  for (int i = seconds; i > 0; i--) {
    snprintf(statusMsg, sizeof(statusMsg), "Starting in %ds", i);
    u8g2.firstPage();
    do {
      u8g2.setFont(u8g2_font_ncenB10_tr);
      u8g2.drawStr(0, 16, "Keep finger");
      u8g2.drawStr(0, 32, "still...");
      u8g2.setFont(u8g2_font_ncenB18_tr);
      u8g2.setCursor(52, 50);
      u8g2.print(i);
      drawStatusBar();
    } while (u8g2.nextPage());

    // Use yieldFor instead of delay — keeps server responsive during countdown
    unsigned long t = millis();
    while (millis() - t < 1000) {
      server.handleClient();
      yield();
      if (cancelRequested) return false;
      delay(1);
    }
  }
  return true;
}

bool takeSingleReading(int idx) {
  int n = sampleCounts[idx];

  for (int i = 0; i < n; i++) {
    server.handleClient();
    yield();
    if (cancelRequested || !fingerPresent()) return false;
    while (!sensor.available()) {
      sensor.check();
      server.handleClient();
      yield();
      if (cancelRequested) return false;
    }
    redBuffer[i] = sensor.getRed();
    irBuffer[i]  = sensor.getIR();
    sensor.nextSample();
  }

  maxim_heart_rate_and_oxygen_saturation(
    irBuffer, n, redBuffer,
    &spo2, &spo2Valid,
    &heartRate, &hrValid
  );

  Serial.printf("[%d] HR=%d(v=%d) SpO2=%d(v=%d)\n",
                idx + 1, heartRate, hrValid, spo2, spo2Valid);

  if (hrValid && heartRate >= 40 && heartRate <= 220) {
    hrReadings[idx] = heartRate;
    validHRCount++;
  } else {
    hrReadings[idx] = 0;
  }

  if (spo2Valid && spo2 >= 80 && spo2 <= 100) {
    spo2Readings[idx] = spo2;
    validSpO2Count++;
  } else {
    spo2Readings[idx] = 0;
  }

  return true;
}

void calculateAverages() {
  float sumHR = 0, sumSpO2 = 0;
  for (int i = 0; i < TOTAL_SAMPLES; i++) {
    if (hrReadings[i]   > 0) sumHR   += hrReadings[i];
    if (spo2Readings[i] > 0) sumSpO2 += spo2Readings[i];
  }
  avgHR   = (validHRCount   > 0) ? sumHR   / validHRCount   : 0;
  avgSpO2 = (validSpO2Count > 0) ? sumSpO2 / validSpO2Count : 0;
  Serial.printf("AVG HR=%.1f (%d valid)  AVG SpO2=%.1f (%d valid)\n",
                avgHR, validHRCount, avgSpO2, validSpO2Count);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);

  Wire.begin(D2, D1);
  u8g2.begin();

  snprintf(statusMsg, sizeof(statusMsg), "Connecting WiFi");
  u8g2.firstPage();
  do {
    u8g2.setFont(u8g2_font_ncenB10_tr);
    u8g2.drawStr(0, 16, "Pulse Ox");
    u8g2.drawStr(0, 34, "Connecting...");
    drawStatusBar();
  } while (u8g2.nextPage());

  WiFiManager wm;
  if (!wm.autoConnect("PulseOx_Setup")) {
    u8g2.firstPage();
    do {
      u8g2.setFont(u8g2_font_ncenB10_tr);
      u8g2.drawStr(0, 16, "WiFi ERROR");
      u8g2.drawStr(0, 34, "Restarting...");
    } while (u8g2.nextPage());
    delay(2000);
    ESP.restart();
  }

  Serial.println("WiFi: " + WiFi.localIP().toString());

  server.on("/start",  HTTP_POST,    handleStart);
  server.on("/cancel", HTTP_POST,    handleCancel);
  server.on("/data",   HTTP_GET,     handleJSON);
  server.on("/start",  HTTP_OPTIONS, handleOptions);
  server.on("/cancel", HTTP_OPTIONS, handleOptions);
  server.on("/data",   HTTP_OPTIONS, handleOptions);

  // Catch-all OPTIONS for any missed preflight
  server.onNotFound([]() {
    if (server.method() == HTTP_OPTIONS) {
      addCORS();
      server.send(204);
    } else {
      server.send(404, "text/plain", "Not found");
    }
  });

  server.begin();

  snprintf(statusMsg, sizeof(statusMsg), "Init sensor...");
  u8g2.firstPage();
  do {
    u8g2.setFont(u8g2_font_ncenB10_tr);
    u8g2.drawStr(0, 16, "Pulse Ox");
    u8g2.drawStr(0, 34, "Init sensor...");
    drawStatusBar();
  } while (u8g2.nextPage());

  if (!sensor.begin(Wire, I2C_SPEED_FAST)) {
    snprintf(statusMsg, sizeof(statusMsg), "ERROR: No sensor");
    u8g2.firstPage();
    do {
      u8g2.setFont(u8g2_font_ncenB10_tr);
      u8g2.drawStr(0, 16, "Sensor ERROR");
      u8g2.drawStr(0, 34, "Check wiring!");
      drawStatusBar();
    } while (u8g2.nextPage());
    while (1) { server.handleClient(); yield(); delay(10); }
  }

  sensor.setup(60, 2, 2, 400, 411, 4096);

  displayIdle();
  Serial.println("Ready - http://" + WiFi.localIP().toString());
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOOP  — server always gets CPU, display redraws throttled to 500ms
// ═══════════════════════════════════════════════════════════════════════════════

void loop() {
  server.handleClient();
  yield();

  if (!running) {
    if (shouldRedisplay()) displayIdle();   // redraw at most every 500ms
    delay(10);                              // was 100 — yield CPU sooner
    return;
  }

  if (cancelRequested) {
    resetMeasurement();
    displayIdle();
    return;
  }

  if (!fingerPresent()) {
    hadFinger = false;
    if (shouldRedisplay()) displayNoFinger();
    server.handleClient();
    delay(10);                              // was 200
    return;
  }

  if (!hadFinger) {
    hadFinger = true;
    displayGreeting();
    yieldFor(800);                          // was delay(800) — server still runs
    if (!interruptibleCountdown(3)) {
      resetMeasurement();
      displayIdle();
      return;
    }
  }

  for (int i = 0; i < TOTAL_SAMPLES; i++) {
    displaySampling(i + 1, TOTAL_SAMPLES);
    server.handleClient();

    if (!takeSingleReading(i)) {
      resetMeasurement();
      displayIdle();
      return;
    }

    server.handleClient();
    yieldFor(300);                          // was delay(300)
  }

  calculateAverages();
  running = false;
  displayResults();
  Serial.println("Measurement complete");

  unsigned long showUntil = millis() + 10000;
  while (millis() < showUntil) {
    server.handleClient();
    yield();
    delay(10);                              // was 50
  }

  patientName[0] = '\0';
  displayIdle();
}