/**
 * Fire Before Fire — ESP32 firmware
 *
 * ACS712 (GPIO 34) + DS18B20 (GPIO 4) → features → rule engine + optional Gaussian NB.
 * SoftAP dashboard from LittleFS: http://192.168.4.1 (SSID FireBeforeFire).
 */
#include <Arduino.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <math.h>
#include <string.h>

// ── WiFi SoftAP (phone/laptop → FireBeforeFire → http://192.168.4.1) ──
#define AP_SSID "FireBeforeFire"
#define AP_PASS "firebefore123"

// Optional: put ESP on your home Wi‑Fi so the phone keeps internet + CDNs work.
// Leave blank ("") to use SoftAP only.
#define STA_SSID ""
#define STA_PASS ""

// Dataset persistence on LittleFS (survives power loss; wiped by uploadfs)
#define DATASET_PATH "/dataset.bin"
#define DATASET_MAGIC 0x46424644u  // 'FBFD'
#define DATASET_VERSION 1

// ── ACS712 ─────────────────────────────────────────────────────────
#define ACS712_PIN 34
#define SENSITIVITY_MV_PER_A 185.0f
#define ADC_MAX 4095.0f
#define VREF 3.3f
#define SAMPLE_COUNT 50
#define LINE_VOLTAGE_V 230.0f

float zeroOffsetMv = 0.0f;

// ── DS18B20 ────────────────────────────────────────────────────────
#define DS18B20_PIN 4
OneWire oneWire(DS18B20_PIN);
DallasTemperature sensors(&oneWire);

WebServer server(80);
DNSServer dnsServer;
const byte DNS_PORT = 53;

// ── Feature window ─────────────────────────────────────────────────
#define HISTORY_LEN 15
#define LOOP_DT_S 1.0f
#define SLOPE_SPAN 5          // use ~5s window (not 1-sample) to kill noise
#define WARN_HOLD_COUNT 3     // need N consecutive breaches before warning

// Sensor noise floors (ignore below these — DS18B20 LSB ≈ 0.0625 °C)
#define DEADBAND_TEMP_SLOPE  0.10f   // °C/s
#define DEADBAND_TEMP_ACC    0.05f   // °C/s²
#define DEADBAND_CURR_SLOPE  0.05f   // A/s
#define DEADBAND_CURRENT     0.05f   // A — treat as zero load
#define EMA_TEMP_ALPHA       0.25f   // smooth DS18B20 before slopes

float emaTempC = NAN;
bool tempSensorOk = false;
uint8_t tempDeviceCount = 0;

struct Sample {
  float currentA;
  float tempC;
  unsigned long ms;
};

Sample history[HISTORY_LEN];
int histCount = 0;
int histHead = 0;
float prevTempSlope = NAN;

#define BATCH_SIZE 60
// Dataset target labels (supervised column for ML / logging)
// 0 = normal, 1 = warn, 2 = critical
struct Features {
  float currentA;
  float tempC;
  float ma3I;
  float ma3T;
  float currentSlope;
  float tempSlope;
  float varI;
  float powerW;
  float tempAcc;
  int8_t target;  // set when a batch is collapsed into dataset[]
};

Features batch[BATCH_SIZE];
int batchCount = 0;
Features latest = {};
Features lastBatchAvg = {};
bool hasBatchAvg = false;

#define MAX_DATASET 100
Features dataset[MAX_DATASET];
int datasetCount = 0;
bool datasetDirty = false;

// ── Gaussian Naive Bayes pipeline ──────────────────────────────────
// Features used for GNB (skip powerW — algebraically = 230*|I|)
#define GNB_CLASSES 3
#define GNB_FEATS 8
#define GNB_MIN_SAMPLES 24
#define GNB_MIN_PER_CLASS 3
#define GNB_MIN_CLASSES 2
#define GNB_CONF_MIN 0.60f      // absolute floor to trust NB
#define GNB_VAR_FLOOR 1e-6f

float gnbMean[GNB_CLASSES][GNB_FEATS];
float gnbVar[GNB_CLASSES][GNB_FEATS];
float gnbLogPrior[GNB_CLASSES];
float gnbPost[GNB_CLASSES];
int gnbClassCount[GNB_CLASSES];
int gnbTrainN = 0;
int gnbSufficiencyScore = 0;   // 0–10
bool gnbSufficient = false;
bool gnbReady = false;
bool gnbActive = false;        // NB currently overriding rule warnings
int8_t gnbPredClass = 0;
float gnbConfidence = 0.0f;
float ruleConfidence = 0.0f;
char gnbStatusMsg[64] = "collecting data";
int8_t gnbPrevPred = 0;

// ── Prediction parameters (importance ★ = weight) ──────────────────
enum ParamId {
  P_CURRENT = 0,
  P_TEMP,
  P_MA3_I,
  P_MA3_T,
  P_CURRENT_SLOPE,
  P_TEMP_SLOPE,
  P_VAR_I,
  P_POWER,
  P_TEMP_ACC,
  P_COUNT
};

struct ParamConfig {
  const char *key;
  const char *label;
  const char *unit;
  float importance;  // 1–5 from your table
  float warn;
  float critical;
};

// Defaults tuned to avoid DS18B20 / ACS712 idle noise false alarms
ParamConfig params[P_COUNT] = {
  {"current",      "Current",                   "A",     4.0f, 12.0f,  16.0f},
  {"temp",         "Temperature",               "C",     5.0f, 55.0f,  70.0f},
  {"ma3I",         "Moving Avg Current",        "A",     3.0f, 11.0f,  15.0f},
  {"ma3T",         "Moving Avg Temperature",    "C",     4.0f, 50.0f,  65.0f},
  {"currentSlope", "Current Slope",             "A/s",   4.0f,  0.80f,  2.00f},
  {"tempSlope",    "Temperature Slope",         "C/s",   5.0f,  0.30f,  0.60f},
  {"varI",         "Current Variance",          "",      3.0f,  0.50f,  1.50f},
  {"power",        "Estimated Power",           "W",     4.0f, 2500.f, 3500.f},
  {"tempAcc",      "Temperature Acceleration",  "C/s2",  5.0f,  0.15f,  0.35f},
};

ParamConfig defaultsBackup[P_COUNT];
bool adaptiveMode = false;  // start manual; adaptive only after user enables / enough calm data

enum WarnLevel { LVL_OK = 0, LVL_WARN = 1, LVL_CRITICAL = 2 };

int breachCount[P_COUNT] = {};

struct ParamStatus {
  float value;
  WarnLevel level;
};

ParamStatus statuses[P_COUNT];
float riskPercent = 0.0f;
const char *overallStatus = "ok";  // ok | caution | danger

#define MAX_WARNINGS 16
struct Warning {
  char param[24];
  char label[40];
  char level[12];  // warn | critical
  float value;
  float threshold;
  unsigned long ms;
};
Warning warnings[MAX_WARNINGS];
int warningCount = 0;

#define MAX_ALERT_LOG 40
Warning alertLog[MAX_ALERT_LOG];
int alertLogCount = 0;

// ── Helpers ────────────────────────────────────────────────────────
float paramValue(const Features &f, int id) {
  switch (id) {
    case P_CURRENT: return fabsf(f.currentA);
    case P_TEMP: return f.tempC;
    case P_MA3_I: return fabsf(f.ma3I);
    case P_MA3_T: return f.ma3T;
    case P_CURRENT_SLOPE: return fabsf(f.currentSlope);
    case P_TEMP_SLOPE: return fabsf(f.tempSlope);
    case P_VAR_I: return f.varI;
    case P_POWER: return f.powerW;
    case P_TEMP_ACC: return fabsf(f.tempAcc);
    default: return 0;
  }
}

float applyDeadband(int id, float v) {
  switch (id) {
    case P_CURRENT:
    case P_MA3_I:
      return (v < DEADBAND_CURRENT) ? 0.0f : v;
    case P_CURRENT_SLOPE:
      return (v < DEADBAND_CURR_SLOPE) ? 0.0f : v;
    case P_TEMP_SLOPE:
      return (v < DEADBAND_TEMP_SLOPE) ? 0.0f : v;
    case P_TEMP_ACC:
      return (v < DEADBAND_TEMP_ACC) ? 0.0f : v;
    case P_POWER:
      return (v < LINE_VOLTAGE_V * DEADBAND_CURRENT) ? 0.0f : v;
    default:
      return v;
  }
}

WarnLevel prevLevels[P_COUNT] = {};

void pushAlert(const Warning &w) {
  if (alertLogCount < MAX_ALERT_LOG) {
    alertLog[alertLogCount++] = w;
  } else {
    for (int i = 1; i < MAX_ALERT_LOG; i++) alertLog[i - 1] = alertLog[i];
    alertLog[MAX_ALERT_LOG - 1] = w;
  }
}

// Fill GNB feature vector (excludes powerW)
void gnbFillFeatures(const Features &f, float out[GNB_FEATS]) {
  out[0] = fabsf(f.currentA);
  out[1] = f.tempC;
  out[2] = fabsf(f.ma3I);
  out[3] = f.ma3T;
  out[4] = fabsf(f.currentSlope);
  out[5] = fabsf(f.tempSlope);
  out[6] = f.varI;
  out[7] = fabsf(f.tempAcc);
}

int assessDatasetSufficiency() {
  int counts[GNB_CLASSES] = {};
  for (int i = 0; i < datasetCount; i++) {
    int t = dataset[i].target;
    if (t < 0) t = 0;
    if (t > 2) t = 2;
    counts[t]++;
  }
  for (int c = 0; c < GNB_CLASSES; c++) gnbClassCount[c] = counts[c];

  int classesPresent = 0;
  int minPresent = 9999;
  for (int c = 0; c < GNB_CLASSES; c++) {
    if (counts[c] > 0) {
      classesPresent++;
      if (counts[c] < minPresent) minPresent = counts[c];
    }
  }
  if (classesPresent == 0) minPresent = 0;

  int maxC = 0;
  for (int c = 0; c < GNB_CLASSES; c++) if (counts[c] > maxC) maxC = counts[c];
  float imbalance = (minPresent > 0) ? ((float)maxC / (float)minPresent) : 99.0f;

  int score = 0;
  if (datasetCount >= GNB_MIN_SAMPLES) score += 2;
  if (datasetCount >= 40) score += 2;
  if (classesPresent >= GNB_MIN_CLASSES) score += 2;
  if (minPresent >= GNB_MIN_PER_CLASS) score += 2;
  if ((counts[1] + counts[2]) >= GNB_MIN_PER_CLASS) score += 1;
  if (imbalance <= 10.0f && classesPresent >= 2) score += 1;

  gnbSufficiencyScore = score;
  gnbSufficient = (score >= 6 && classesPresent >= GNB_MIN_CLASSES &&
                   minPresent >= GNB_MIN_PER_CLASS &&
                   datasetCount >= GNB_MIN_SAMPLES);

  if (!gnbSufficient) {
    if (datasetCount < GNB_MIN_SAMPLES) {
      snprintf(gnbStatusMsg, sizeof(gnbStatusMsg), "need %d rows (have %d)", GNB_MIN_SAMPLES, datasetCount);
    } else if (classesPresent < GNB_MIN_CLASSES) {
      snprintf(gnbStatusMsg, sizeof(gnbStatusMsg), "need warn/critical labels");
    } else if (minPresent < GNB_MIN_PER_CLASS) {
      snprintf(gnbStatusMsg, sizeof(gnbStatusMsg), "need ≥%d/class (min=%d)", GNB_MIN_PER_CLASS, minPresent);
    } else {
      snprintf(gnbStatusMsg, sizeof(gnbStatusMsg), "score %d/10 — collecting", score);
    }
  } else {
    snprintf(gnbStatusMsg, sizeof(gnbStatusMsg), "sufficient %d/10 — model ready", score);
  }
  return score;
}

bool fitGaussianNB() {
  assessDatasetSufficiency();
  if (!gnbSufficient) {
    gnbReady = false;
    gnbActive = false;
    return false;
  }

  memset(gnbMean, 0, sizeof(gnbMean));
  memset(gnbVar, 0, sizeof(gnbVar));
  memset(gnbClassCount, 0, sizeof(gnbClassCount));
  memset(gnbLogPrior, 0, sizeof(gnbLogPrior));

  float x[GNB_FEATS];
  for (int i = 0; i < datasetCount; i++) {
    int c = dataset[i].target;
    if (c < 0) c = 0;
    if (c > 2) c = 2;
    gnbFillFeatures(dataset[i], x);
    gnbClassCount[c]++;
    for (int j = 0; j < GNB_FEATS; j++) gnbMean[c][j] += x[j];
  }

  for (int c = 0; c < GNB_CLASSES; c++) {
    if (gnbClassCount[c] == 0) continue;
    for (int j = 0; j < GNB_FEATS; j++) gnbMean[c][j] /= (float)gnbClassCount[c];
  }

  for (int i = 0; i < datasetCount; i++) {
    int c = dataset[i].target;
    if (c < 0) c = 0;
    if (c > 2) c = 2;
    gnbFillFeatures(dataset[i], x);
    for (int j = 0; j < GNB_FEATS; j++) {
      float d = x[j] - gnbMean[c][j];
      gnbVar[c][j] += d * d;
    }
  }

  for (int c = 0; c < GNB_CLASSES; c++) {
    if (gnbClassCount[c] == 0) continue;
    float denom = (gnbClassCount[c] > 1) ? (float)(gnbClassCount[c] - 1) : 1.0f;
    for (int j = 0; j < GNB_FEATS; j++) {
      gnbVar[c][j] /= denom;
      if (gnbVar[c][j] < GNB_VAR_FLOOR) gnbVar[c][j] = GNB_VAR_FLOOR;
    }
    gnbLogPrior[c] = logf((float)gnbClassCount[c] / (float)datasetCount);
  }

  gnbTrainN = datasetCount;
  gnbReady = true;
  snprintf(gnbStatusMsg, sizeof(gnbStatusMsg), "fitted n=%d score=%d/10", gnbTrainN, gnbSufficiencyScore);
  Serial.printf("[GNB] fitted n=%d counts=[%d,%d,%d] score=%d/10\n",
                gnbTrainN, gnbClassCount[0], gnbClassCount[1], gnbClassCount[2], gnbSufficiencyScore);
  return true;
}

// Returns predicted class; fills gnbPost[] and gnbConfidence
int8_t predictGaussianNB(const Features &f) {
  float x[GNB_FEATS];
  gnbFillFeatures(f, x);

  float logp[GNB_CLASSES];
  float maxLog = -1e30f;
  for (int c = 0; c < GNB_CLASSES; c++) {
    if (gnbClassCount[c] == 0) {
      logp[c] = -1e30f;
      continue;
    }
    float lp = gnbLogPrior[c];
    for (int j = 0; j < GNB_FEATS; j++) {
      float v = gnbVar[c][j];
      float d = x[j] - gnbMean[c][j];
      lp += -0.5f * (logf(2.0f * 3.14159265f * v) + (d * d) / v);
    }
    logp[c] = lp;
    if (lp > maxLog) maxLog = lp;
  }

  float sum = 0.0f;
  for (int c = 0; c < GNB_CLASSES; c++) {
    gnbPost[c] = (gnbClassCount[c] == 0) ? 0.0f : expf(logp[c] - maxLog);
    sum += gnbPost[c];
  }
  if (sum < 1e-12f) sum = 1e-12f;
  for (int c = 0; c < GNB_CLASSES; c++) gnbPost[c] /= sum;

  int8_t best = 0;
  float bestP = gnbPost[0];
  for (int c = 1; c < GNB_CLASSES; c++) {
    if (gnbPost[c] > bestP) {
      bestP = gnbPost[c];
      best = (int8_t)c;
    }
  }
  gnbPredClass = best;
  gnbConfidence = bestP;
  return best;
}

void applyGnbOverrideIfConfident() {
  gnbActive = false;
  if (!gnbReady) return;

  // Use NB when confidence beats both the floor and the rule-engine confidence
  if (gnbConfidence >= GNB_CONF_MIN && gnbConfidence >= ruleConfidence) {
    gnbActive = true;
    if (gnbPredClass >= 2) {
      overallStatus = "danger";
      riskPercent = 55.0f + gnbPost[2] * 45.0f;
    } else if (gnbPredClass == 1) {
      overallStatus = "caution";
      riskPercent = 25.0f + gnbPost[1] * 30.0f;
    } else {
      overallStatus = "ok";
      riskPercent = (1.0f - gnbPost[0]) * 20.0f;
    }

    // Replace rule warnings with a single GNB prediction banner
    warningCount = 0;
    if (gnbPredClass >= 1 && warningCount < MAX_WARNINGS) {
      Warning &w = warnings[warningCount++];
      strncpy(w.param, "gnb", sizeof(w.param) - 1);
      w.param[sizeof(w.param) - 1] = '\0';
      strncpy(w.label, "Gaussian NB prediction", sizeof(w.label) - 1);
      w.label[sizeof(w.label) - 1] = '\0';
      strncpy(w.level, gnbPredClass >= 2 ? "critical" : "warn", sizeof(w.level) - 1);
      w.level[sizeof(w.level) - 1] = '\0';
      w.value = gnbConfidence * 100.0f;
      w.threshold = GNB_CONF_MIN * 100.0f;
      w.ms = millis();
      if (gnbPredClass > gnbPrevPred) pushAlert(w);
    }
    gnbPrevPred = gnbPredClass;
  }
}

void evaluatePrediction(const Features &f) {
  warningCount = 0;
  float weighted = 0.0f;
  float totalW = 0.0f;

  for (int i = 0; i < P_COUNT; i++) {
    float raw = paramValue(f, i);
    float v = applyDeadband(i, raw);
    statuses[i].value = raw;  // show raw on UI
    totalW += params[i].importance;

    WarnLevel candidate = LVL_OK;
    if (v >= params[i].critical) candidate = LVL_CRITICAL;
    else if (v >= params[i].warn) candidate = LVL_WARN;

    // debounce: require sustained breach
    if (candidate != LVL_OK) {
      if (breachCount[i] < 100) breachCount[i]++;
    } else {
      breachCount[i] = 0;
    }

    WarnLevel lvl = LVL_OK;
    if (breachCount[i] >= WARN_HOLD_COUNT) lvl = candidate;
    statuses[i].level = lvl;

    float contrib = 0.0f;
    if (lvl == LVL_CRITICAL) contrib = 1.0f;
    else if (lvl == LVL_WARN) contrib = 0.55f;
    // soft contrib only in upper half of warn band (cuts idle false risk)
    else if (params[i].warn > 0.0f && v > params[i].warn * 0.6f) {
      contrib = ((v / params[i].warn) - 0.6f) / 0.4f * 0.2f;
    }
    weighted += params[i].importance * contrib;

    if (lvl != LVL_OK && warningCount < MAX_WARNINGS) {
      Warning &w = warnings[warningCount++];
      strncpy(w.param, params[i].key, sizeof(w.param) - 1);
      w.param[sizeof(w.param) - 1] = '\0';
      strncpy(w.label, params[i].label, sizeof(w.label) - 1);
      w.label[sizeof(w.label) - 1] = '\0';
      strncpy(w.level, lvl == LVL_CRITICAL ? "critical" : "warn", sizeof(w.level) - 1);
      w.level[sizeof(w.level) - 1] = '\0';
      w.value = raw;
      w.threshold = lvl == LVL_CRITICAL ? params[i].critical : params[i].warn;
      w.ms = millis();
      if (lvl > prevLevels[i]) pushAlert(w);
    }
    prevLevels[i] = lvl;
  }

  riskPercent = totalW > 0 ? (100.0f * weighted / totalW) : 0.0f;
  if (riskPercent >= 55.0f) overallStatus = "danger";
  else if (riskPercent >= 25.0f) overallStatus = "caution";
  else overallStatus = "ok";

  ruleConfidence = totalW > 0 ? (weighted / totalW) : 0.0f;

  // Pipeline: if dataset is statistically sufficient and NB is confident, override rules
  if (gnbReady) {
    predictGaussianNB(f);
    applyGnbOverrideIfConfident();
  } else {
    gnbActive = false;
    gnbConfidence = 0.0f;
    gnbPredClass = 0;
  }
}

// Adaptive: never drop below fire-safe defaults (prevents noise-trained false alarms)
void applyAdaptiveThresholds() {
  if (datasetCount < 3) return;

  for (int i = 0; i < P_COUNT; i++) {
    float mean = 0.0f;
    for (int d = 0; d < datasetCount; d++) {
      mean += applyDeadband(i, paramValue(dataset[d], i));
    }
    mean /= datasetCount;

    float var = 0.0f;
    for (int d = 0; d < datasetCount; d++) {
      float x = applyDeadband(i, paramValue(dataset[d], i)) - mean;
      var += x * x;
    }
    float std = sqrtf(var / datasetCount);
    if (std < 1e-4f) std = 1e-4f;

    float kWarn = 3.5f - 0.25f * params[i].importance;  // looser than before
    float kCrit = kWarn + 1.5f;

    float adaptWarn = mean + kWarn * std;
    float adaptCrit = mean + kCrit * std;

    // NEVER tighten below factory defaults
    params[i].warn = max(adaptWarn, defaultsBackup[i].warn);
    params[i].critical = max(adaptCrit, max(params[i].warn * 1.3f, defaultsBackup[i].critical));
  }
  adaptiveMode = true;
}

void restoreDefaultThresholds() {
  for (int i = 0; i < P_COUNT; i++) {
    params[i].warn = defaultsBackup[i].warn;
    params[i].critical = defaultsBackup[i].critical;
  }
}

// Label a feature row for dataset[] using thresholds + temperature sensor.
// Instant (no debounce) — suitable for offline / ML training labels.
int8_t computeTarget(const Features &f) {
  int8_t t = 0;

  // Temperature sensor is the primary fire-heating signal
  float temp = f.tempC;
  if (!isnan(temp)) {
    if (temp >= params[P_TEMP].critical) t = 2;
    else if (temp >= params[P_TEMP].warn) t = 1;
  }

  // Raise label if any other parameter crosses warn/critical
  for (int i = 0; i < P_COUNT; i++) {
    float v = applyDeadband(i, paramValue(f, i));
    int8_t lvl = 0;
    if (v >= params[i].critical) lvl = 2;
    else if (v >= params[i].warn) lvl = 1;
    if (lvl > t) t = lvl;
  }
  return t;
}

const char *targetName(int8_t t) {
  if (t >= 2) return "critical";
  if (t == 1) return "warn";
  return "ok";
}

// ── Sensor / features ──────────────────────────────────────────────
void pushSample(float currentA, float tempC) {
  history[histHead] = {currentA, tempC, millis()};
  histHead = (histHead + 1) % HISTORY_LEN;
  if (histCount < HISTORY_LEN) histCount++;
}

Sample getSample(int age) {
  int idx = (histHead - 1 - age + HISTORY_LEN * 2) % HISTORY_LEN;
  return history[idx];
}

float readVoltageMv() {
  long sum = 0;
  for (int i = 0; i < SAMPLE_COUNT; i++) {
    sum += analogRead(ACS712_PIN);
    delayMicroseconds(200);
  }
  return (sum / (float)SAMPLE_COUNT / ADC_MAX) * VREF * 1000.0f;
}

void calibrateZero() {
  Serial.println("Calibrating zero current... keep load OFF");
  delay(1000);
  float sum = 0.0f;
  for (int i = 0; i < 100; i++) {
    sum += readVoltageMv();
    delay(10);
  }
  zeroOffsetMv = sum / 100.0f;
  Serial.printf("Zero offset: %.1f mV\n", zeroOffsetMv);
}

float readCurrentAmps() {
  return (readVoltageMv() - zeroOffsetMv) / SENSITIVITY_MV_PER_A;
}

float readTemperatureC() {
  sensors.requestTemperatures();
  return sensors.getTempCByIndex(0);
}

static inline float nz(float v) { return isnan(v) ? 0.0f : v; }

float ma3(bool useTemp) {
  if (histCount < 1) return NAN;
  int n = min(3, histCount);
  float sum = 0.0f;
  for (int i = 0; i < n; i++) {
    Sample s = getSample(i);
    sum += useTemp ? s.tempC : s.currentA;
  }
  return sum / n;
}

float slope(bool useTemp) {
  if (histCount < 2) return NAN;
  int span = min(SLOPE_SPAN, histCount - 1);
  Sample a = getSample(0);       // newest
  Sample b = getSample(span);    // older
  float dt = (a.ms - b.ms) / 1000.0f;
  if (dt < 0.5f) return NAN;
  float dy = useTemp ? (a.tempC - b.tempC) : (a.currentA - b.currentA);
  return dy / dt;
}

float variance(bool useTemp) {
  if (histCount < 2) return NAN;
  float mean = 0.0f;
  for (int i = 0; i < histCount; i++) {
    Sample s = getSample(i);
    mean += useTemp ? s.tempC : s.currentA;
  }
  mean /= histCount;
  float sumSq = 0.0f;
  for (int i = 0; i < histCount; i++) {
    Sample s = getSample(i);
    float v = useTemp ? s.tempC : s.currentA;
    float d = v - mean;
    sumSq += d * d;
  }
  return sumSq / histCount;
}

float smoothTemp(float rawC) {
  if (isnan(emaTempC)) emaTempC = rawC;
  else emaTempC = EMA_TEMP_ALPHA * rawC + (1.0f - EMA_TEMP_ALPHA) * emaTempC;
  return emaTempC;
}

bool saveDatasetToFs() {
  if (!LittleFS.begin(false)) return false;
  File f = LittleFS.open(DATASET_PATH, "w");
  if (!f) {
    Serial.println("[FS] dataset save open failed");
    return false;
  }
  uint32_t magic = DATASET_MAGIC;
  uint16_t ver = DATASET_VERSION;
  uint16_t count = (uint16_t)datasetCount;
  bool ok = f.write((uint8_t *)&magic, sizeof(magic)) == sizeof(magic)
         && f.write((uint8_t *)&ver, sizeof(ver)) == sizeof(ver)
         && f.write((uint8_t *)&count, sizeof(count)) == sizeof(count);
  if (ok && count > 0) {
    size_t bytes = (size_t)count * sizeof(Features);
    ok = f.write((uint8_t *)dataset, bytes) == bytes;
  }
  f.close();
  if (ok) {
    datasetDirty = false;
    Serial.printf("[FS] saved dataset (%d rows) → %s\n", datasetCount, DATASET_PATH);
  } else {
    Serial.println("[FS] dataset save write failed");
  }
  return ok;
}

bool loadDatasetFromFs() {
  if (!LittleFS.exists(DATASET_PATH)) {
    Serial.println("[FS] no persisted dataset yet");
    return false;
  }
  File f = LittleFS.open(DATASET_PATH, "r");
  if (!f) {
    Serial.println("[FS] dataset load open failed");
    return false;
  }
  uint32_t magic = 0;
  uint16_t ver = 0;
  uint16_t count = 0;
  bool ok = f.read((uint8_t *)&magic, sizeof(magic)) == sizeof(magic)
         && f.read((uint8_t *)&ver, sizeof(ver)) == sizeof(ver)
         && f.read((uint8_t *)&count, sizeof(count)) == sizeof(count);
  if (!ok || magic != DATASET_MAGIC || ver != DATASET_VERSION || count > MAX_DATASET) {
    Serial.printf("[FS] dataset header invalid (magic=0x%08lx ver=%u count=%u)\n",
                  (unsigned long)magic, ver, count);
    f.close();
    return false;
  }
  if (count > 0) {
    size_t bytes = (size_t)count * sizeof(Features);
    if (f.read((uint8_t *)dataset, bytes) != bytes) {
      Serial.println("[FS] dataset body read failed");
      f.close();
      datasetCount = 0;
      return false;
    }
  }
  f.close();
  datasetCount = count;
  datasetDirty = false;
  if (datasetCount > 0) {
    lastBatchAvg = dataset[datasetCount - 1];
    hasBatchAvg = true;
  }
  Serial.printf("[FS] loaded dataset (%d rows) from %s\n", datasetCount, DATASET_PATH);
  return true;
}

void collapseBatchToAverage() {
  Features avg = {};
  for (int i = 0; i < batchCount; i++) {
    avg.currentA += batch[i].currentA;
    avg.tempC += batch[i].tempC;
    avg.ma3I += batch[i].ma3I;
    avg.ma3T += batch[i].ma3T;
    avg.currentSlope += batch[i].currentSlope;
    avg.tempSlope += batch[i].tempSlope;
    avg.varI += batch[i].varI;
    avg.powerW += batch[i].powerW;
    avg.tempAcc += batch[i].tempAcc;
  }
  float n = (float)batchCount;
  avg.currentA /= n; avg.tempC /= n; avg.ma3I /= n; avg.ma3T /= n;
  avg.currentSlope /= n; avg.tempSlope /= n; avg.varI /= n;
  avg.powerW /= n; avg.tempAcc /= n;
  avg.target = computeTarget(avg);  // label from thresholds + temp sensor

  memset(batch, 0, sizeof(batch));
  batch[0] = avg;
  lastBatchAvg = avg;
  hasBatchAvg = true;
  batchCount = 0;  // start next window (avg also kept in dataset)

  if (datasetCount < MAX_DATASET) dataset[datasetCount++] = avg;
  else {
    for (int i = 1; i < MAX_DATASET; i++) dataset[i - 1] = dataset[i];
    dataset[MAX_DATASET - 1] = avg;
  }

  datasetDirty = true;
  saveDatasetToFs();

  if (adaptiveMode) applyAdaptiveThresholds();

  // Retrain GNB whenever a labeled row is added (no-op until statistically sufficient)
  fitGaussianNB();

  Serial.printf("=== Batch avg → dataset[%d] target=%d (%s) adaptive=%s gnb=%s ===\n",
                datasetCount - 1, (int)avg.target, targetName(avg.target),
                adaptiveMode ? "ON" : "OFF",
                gnbReady ? (gnbActive ? "ACTIVE" : "ready") : "waiting");
  Serial.printf(
    "  I=%.3f T=%.2f MA3I=%.3f MA3T=%.2f dI=%.3f dT=%.3f Var=%.4f P=%.1f d2T=%.4f\n",
    avg.currentA, avg.tempC, avg.ma3I, avg.ma3T,
    avg.currentSlope, avg.tempSlope, avg.varI, avg.powerW, avg.tempAcc
  );
}

// ── JSON builders ──────────────────────────────────────────────────
void appendParamsJson(JsonObject obj) {
  for (int i = 0; i < P_COUNT; i++) {
    JsonObject p = obj[params[i].key].to<JsonObject>();
    p["label"] = params[i].label;
    p["unit"] = params[i].unit;
    p["importance"] = params[i].importance;
    p["warn"] = params[i].warn;
    p["critical"] = params[i].critical;
  }
}

void appendFeatureRow(JsonObject row, const Features &f) {
  row["current"] = f.currentA;
  row["temp"] = f.tempC;
  row["ma3I"] = f.ma3I;
  row["ma3T"] = f.ma3T;
  row["currentSlope"] = f.currentSlope;
  row["tempSlope"] = f.tempSlope;
  row["varI"] = f.varI;
  row["power"] = f.powerW;
  row["tempAcc"] = f.tempAcc;
  row["target"] = (int)f.target;
  row["targetLabel"] = targetName(f.target);
}

void handleStatus() {
  JsonDocument doc;
  doc["mode"] = adaptiveMode ? "adaptive" : "manual";
  doc["riskPercent"] = riskPercent;
  doc["status"] = overallStatus;
  doc["datasetCount"] = datasetCount;
  doc["batchCount"] = batchCount;
  doc["batchSize"] = BATCH_SIZE;
  doc["predictionSource"] = gnbActive ? "gnb" : "rules";
  if (hasBatchAvg) {
    doc["lastTarget"] = (int)lastBatchAvg.target;
    doc["lastTargetLabel"] = targetName(lastBatchAvg.target);
  }

  JsonObject sens = doc["sensors"].to<JsonObject>();
  sens["tempOk"] = tempSensorOk;
  sens["tempDevices"] = tempDeviceCount;
  sens["currentOk"] = true;

  JsonObject persist = doc["persist"].to<JsonObject>();
  persist["path"] = DATASET_PATH;
  persist["saved"] = LittleFS.exists(DATASET_PATH);
  persist["dirty"] = datasetDirty;
  persist["count"] = datasetCount;

  JsonObject gnb = doc["gnb"].to<JsonObject>();
  gnb["sufficient"] = gnbSufficient;
  gnb["ready"] = gnbReady;
  gnb["active"] = gnbActive;
  gnb["score"] = gnbSufficiencyScore;
  gnb["trainN"] = gnbTrainN;
  gnb["pred"] = (int)gnbPredClass;
  gnb["predLabel"] = targetName(gnbPredClass);
  gnb["confidence"] = gnbConfidence;
  gnb["ruleConfidence"] = ruleConfidence;
  gnb["confMin"] = GNB_CONF_MIN;
  gnb["status"] = gnbStatusMsg;
  JsonArray cc = gnb["classCounts"].to<JsonArray>();
  for (int c = 0; c < GNB_CLASSES; c++) cc.add(gnbClassCount[c]);
  JsonArray post = gnb["posteriors"].to<JsonArray>();
  for (int c = 0; c < GNB_CLASSES; c++) post.add(gnbPost[c]);

  JsonObject feat = doc["features"].to<JsonObject>();
  Features live = latest;
  live.target = computeTarget(latest);  // preview label (dataset rows get final label at batch collapse)
  appendFeatureRow(feat, live);

  JsonObject th = doc["thresholds"].to<JsonObject>();
  appendParamsJson(th);

  JsonArray st = doc["paramStatus"].to<JsonArray>();
  for (int i = 0; i < P_COUNT; i++) {
    JsonObject row = st.add<JsonObject>();
    row["key"] = params[i].key;
    row["label"] = params[i].label;
    row["unit"] = params[i].unit;
    row["importance"] = params[i].importance;
    row["value"] = statuses[i].value;
    row["warn"] = params[i].warn;
    row["critical"] = params[i].critical;
    row["level"] = statuses[i].level == LVL_CRITICAL ? "critical"
                 : statuses[i].level == LVL_WARN ? "warn" : "ok";
  }

  JsonArray wa = doc["warnings"].to<JsonArray>();
  for (int i = 0; i < warningCount; i++) {
    JsonObject w = wa.add<JsonObject>();
    w["param"] = warnings[i].param;
    w["label"] = warnings[i].label;
    w["level"] = warnings[i].level;
    w["value"] = warnings[i].value;
    w["threshold"] = warnings[i].threshold;
    w["ms"] = warnings[i].ms;
    w["source"] = (strcmp(warnings[i].param, "gnb") == 0) ? "gnb" : "rules";
  }

  String out;
  serializeJson(doc, out);
  server.send(200, "application/json", out);
}

void handleDataset() {
  // Keep payload small for ESP32 RAM — return all stored rows
  JsonDocument doc;
  doc["count"] = datasetCount;
  doc["max"] = MAX_DATASET;
  doc["legend"] = "target: 0=ok, 1=warn, 2=critical (thresholds + temp sensor)";
  JsonObject gnb = doc["gnb"].to<JsonObject>();
  gnb["sufficient"] = gnbSufficient;
  gnb["ready"] = gnbReady;
  gnb["active"] = gnbActive;
  gnb["score"] = gnbSufficiencyScore;
  gnb["status"] = gnbStatusMsg;
  JsonArray rows = doc["rows"].to<JsonArray>();
  for (int i = 0; i < datasetCount; i++) {
    JsonObject row = rows.add<JsonObject>();
    row["i"] = i;
    appendFeatureRow(row, dataset[i]);
  }
  String out;
  serializeJson(doc, out);
  server.send(200, "application/json", out);
}

void handleGnb() {
  assessDatasetSufficiency();
  JsonDocument doc;
  doc["sufficient"] = gnbSufficient;
  doc["ready"] = gnbReady;
  doc["active"] = gnbActive;
  doc["score"] = gnbSufficiencyScore;
  doc["trainN"] = gnbTrainN;
  doc["datasetCount"] = datasetCount;
  doc["datasetMax"] = MAX_DATASET;
  doc["minSamples"] = GNB_MIN_SAMPLES;
  doc["minPerClass"] = GNB_MIN_PER_CLASS;
  doc["confMin"] = GNB_CONF_MIN;
  doc["pred"] = (int)gnbPredClass;
  doc["predLabel"] = targetName(gnbPredClass);
  doc["confidence"] = gnbConfidence;
  doc["ruleConfidence"] = ruleConfidence;
  doc["status"] = gnbStatusMsg;
  JsonArray cc = doc["classCounts"].to<JsonArray>();
  for (int c = 0; c < GNB_CLASSES; c++) cc.add(gnbClassCount[c]);
  JsonArray post = doc["posteriors"].to<JsonArray>();
  for (int c = 0; c < GNB_CLASSES; c++) post.add(gnbPost[c]);
  String out;
  serializeJson(doc, out);
  server.send(200, "application/json", out);
}

void handleGetThresholds() {
  JsonDocument doc;
  doc["mode"] = adaptiveMode ? "adaptive" : "manual";
  JsonObject th = doc["thresholds"].to<JsonObject>();
  appendParamsJson(th);
  String out;
  serializeJson(doc, out);
  server.send(200, "application/json", out);
}

void handlePostThresholds() {
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"missing body\"}");
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, server.arg("plain"))) {
    server.send(400, "application/json", "{\"error\":\"bad json\"}");
    return;
  }

  if (doc["mode"].is<const char *>()) {
    const char *m = doc["mode"];
    adaptiveMode = (strcmp(m, "adaptive") == 0);
  } else {
    adaptiveMode = false;  // manual save implies manual mode
  }

  JsonObject th = doc["thresholds"].as<JsonObject>();
  if (!th.isNull()) {
    for (int i = 0; i < P_COUNT; i++) {
      if (!th[params[i].key].is<JsonObject>()) continue;
      JsonObject p = th[params[i].key];
      if (p["warn"].is<float>()) params[i].warn = p["warn"].as<float>();
      if (p["critical"].is<float>()) params[i].critical = p["critical"].as<float>();
    }
  }

  if (adaptiveMode) applyAdaptiveThresholds();
  evaluatePrediction(latest);

  server.send(200, "application/json", "{\"ok\":true}");
}

void handleAdaptive() {
  if (server.hasArg("plain")) {
    JsonDocument doc;
    deserializeJson(doc, server.arg("plain"));
    if (doc["enabled"].is<bool>()) adaptiveMode = doc["enabled"].as<bool>();
  } else {
    adaptiveMode = true;
  }
  if (adaptiveMode) applyAdaptiveThresholds();
  evaluatePrediction(latest);
  handleGetThresholds();
}

void handleResetDefaults() {
  restoreDefaultThresholds();
  adaptiveMode = false;
  evaluatePrediction(latest);
  handleGetThresholds();
}

void handleAlerts() {
  JsonDocument doc;
  JsonArray arr = doc["alerts"].to<JsonArray>();
  for (int i = alertLogCount - 1; i >= 0; i--) {
    JsonObject a = arr.add<JsonObject>();
    a["param"] = alertLog[i].param;
    a["label"] = alertLog[i].label;
    a["level"] = alertLog[i].level;
    a["value"] = alertLog[i].value;
    a["threshold"] = alertLog[i].threshold;
    a["ms"] = alertLog[i].ms;
    a["state"] = "current";
  }
  String out;
  serializeJson(doc, out);
  server.send(200, "application/json", out);
}

bool serveFsFile(const String &path, const char *contentType) {
  if (!LittleFS.exists(path)) return false;
  File f = LittleFS.open(path, "r");
  if (!f) return false;
  server.streamFile(f, contentType);
  f.close();
  return true;
}

void handleRoot() {
  if (serveFsFile("/index.html", "text/html")) return;
  // Fallback if filesystem missing
  String html =
    "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Fire Before Fire</title>"
    "<style>body{font-family:system-ui;background:#0B1220;color:#F1F5F9;padding:2rem}"
    "code{background:#151F30;padding:.2rem .4rem;border-radius:4px}</style></head><body>"
    "<h1>Fire Before Fire</h1>"
    "<p>Web files not found on LittleFS.</p>"
    "<p>Run: <code>pio run -t uploadfs</code></p>"
    "<p>API check: <a href='/api/status' style='color:#60A5FA'>/api/status</a></p>"
    "</body></html>";
  server.send(200, "text/html", html);
}

void handleCaptive() {
  // Android / iOS captive-portal probes → send them to our UI
  server.sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/", true);
  server.send(302, "text/plain", "");
}

void setupWeb() {
  // SoftAP-only when no home Wi‑Fi is configured (AP+STA with empty STA is flaky)
  if (strlen(STA_SSID) > 0) {
    WiFi.mode(WIFI_AP_STA);
  } else {
    WiFi.mode(WIFI_AP);
  }

  WiFi.setSleep(false);
  delay(100);

  IPAddress apIP(192, 168, 4, 1);
  IPAddress gateway(192, 168, 4, 1);
  IPAddress subnet(255, 255, 255, 0);
  WiFi.softAPConfig(apIP, gateway, subnet);

  // channel 6, visible SSID, max 4 clients
  bool apOk = WiFi.softAP(AP_SSID, AP_PASS, 6, 0, 4);
  delay(300);

  Serial.println();
  Serial.println("========================================");
  Serial.printf("SoftAP %s\n", apOk ? "STARTED" : "FAILED");
  Serial.printf("  SSID    : %s\n", AP_SSID);
  Serial.printf("  Password: %s\n", AP_PASS);
  Serial.printf("  Open    : http://%s\n", WiFi.softAPIP().toString().c_str());
  Serial.println("  1) Join Wi‑Fi 'FireBeforeFire'");
  Serial.println("  2) Ignore 'no internet' warning");
  Serial.println("  3) Open http://192.168.4.1");
  Serial.println("========================================");

  if (strlen(STA_SSID) > 0) {
    WiFi.begin(STA_SSID, STA_PASS);
    Serial.printf("Connecting STA to %s", STA_SSID);
    for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
      delay(250);
      Serial.print('.');
    }
    Serial.println();
    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("STA OK  also open http://%s\n", WiFi.localIP().toString().c_str());
    } else {
      Serial.println("STA failed — SoftAP still available");
    }
  }

  dnsServer.start(DNS_PORT, "*", WiFi.softAPIP());

  // Do NOT format on fail — that would wipe uploadfs data
  if (!LittleFS.begin(false)) {
    Serial.println("LittleFS mount FAILED — upload filesystem: pio run -t uploadfs");
  } else {
    Serial.println("LittleFS mounted. Files:");
    File root = LittleFS.open("/");
    File file = root.openNextFile();
    while (file) {
      Serial.printf("  %s  (%u bytes)\n", file.name(), (unsigned)file.size());
      file = root.openNextFile();
    }
    if (loadDatasetFromFs()) {
      fitGaussianNB();
      if (adaptiveMode) applyAdaptiveThresholds();
    }
  }

  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/api/dataset", HTTP_GET, handleDataset);
  server.on("/api/gnb", HTTP_GET, handleGnb);
  server.on("/api/thresholds", HTTP_GET, handleGetThresholds);
  server.on("/api/thresholds", HTTP_POST, handlePostThresholds);
  server.on("/api/adaptive", HTTP_POST, handleAdaptive);
  server.on("/api/defaults", HTTP_POST, handleResetDefaults);
  server.on("/api/alerts", HTTP_GET, handleAlerts);

  server.on("/", HTTP_GET, handleRoot);
  server.on("/index.html", HTTP_GET, handleRoot);
  server.on("/scripts.js", HTTP_GET, []() {
    if (!serveFsFile("/scripts.js", "application/javascript")) {
      server.send(404, "text/plain", "Missing scripts.js");
    }
  });
  server.on("/app.css", HTTP_GET, []() {
    if (!serveFsFile("/app.css", "text/css")) {
      server.send(404, "text/plain", "Missing app.css");
    }
  });
  server.on("/generate_204", HTTP_GET, handleCaptive);           // Android
  server.on("/hotspot-detect.html", HTTP_GET, handleCaptive);    // iOS
  server.on("/connecttest.txt", HTTP_GET, handleCaptive);        // Windows
  server.on("/ncsi.txt", HTTP_GET, handleCaptive);

  server.onNotFound([]() {
    String path = server.uri();
    if (path.indexOf('.') < 0) {
      handleCaptive();
      return;
    }
    const char *ctype = "text/plain";
    if (path.endsWith(".html")) ctype = "text/html";
    else if (path.endsWith(".js")) ctype = "application/javascript";
    else if (path.endsWith(".css")) ctype = "text/css";
    else if (path.endsWith(".json")) ctype = "application/json";
    if (!serveFsFile(path, ctype)) {
      server.send(404, "text/plain", "Not found: " + path);
    }
  });

  server.begin();
  Serial.println("HTTP server started on port 80");
}

void setup() {
  Serial.begin(115200);
  delay(300);

  memcpy(defaultsBackup, params, sizeof(params));

  // Start Wi‑Fi / web FIRST so the page is reachable during sensor calibrate
  setupWeb();

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  pinMode(ACS712_PIN, INPUT);

  sensors.begin();
  sensors.setResolution(12);
  tempDeviceCount = sensors.getDeviceCount();
  Serial.printf("DS18B20 devices found: %u\n", (unsigned)tempDeviceCount);
  if (tempDeviceCount == 0) {
    Serial.println("WARNING: no DS18B20 on GPIO 4 — dashboard will show sensor fault");
  }
  calibrateZero();

  Serial.println("Fire Before Fire — ready (false-alarm hardened)");
  Serial.println("Connect Wi‑Fi: FireBeforeFire / firebefore123");
  Serial.println("Open: http://192.168.4.1");
  Serial.println("# I  T  MA3I MA3T dI/dt dT/dt Var P d2T  risk%");
}

void serveClientsFor(unsigned long ms) {
  unsigned long start = millis();
  while (millis() - start < ms) {
    dnsServer.processNextRequest();
    server.handleClient();
    delay(2);
  }
}

void loop() {
  dnsServer.processNextRequest();
  server.handleClient();

  float currentA = readCurrentAmps();
  if (fabsf(currentA) < DEADBAND_CURRENT) currentA = 0.0f;

  float tempRaw = readTemperatureC();
  // DS18B20 returns -127 °C when the bus/device is missing
  tempSensorOk = (tempRaw != DEVICE_DISCONNECTED_C);
  tempDeviceCount = sensors.getDeviceCount();

  if (!tempSensorOk) {
    // Keep current live so the UI is not stuck at all-zeros from boot Features{}
    latest.currentA = currentA;
    latest.powerW = LINE_VOLTAGE_V * fabsf(currentA);
    latest.currentSlope = nz(slope(false));
    latest.varI = nz(variance(false));
    latest.ma3I = nz(ma3(false));
    static unsigned long lastTempWarn = 0;
    if (millis() - lastTempWarn > 5000) {
      lastTempWarn = millis();
      Serial.printf("[SENSOR] DS18B20 fault (raw=%.2f, devices=%u) — check GPIO 4 wiring\n",
                    tempRaw, (unsigned)tempDeviceCount);
    }
    serveClientsFor(200);
    return;
  }
  float tempC = smoothTemp(tempRaw);

  pushSample(currentA, tempC);

  Features f = {};
  f.currentA = currentA;
  f.tempC = tempC;
  f.ma3I = nz(ma3(false));
  f.ma3T = nz(ma3(true));
  f.currentSlope = nz(slope(false));
  f.tempSlope = nz(slope(true));
  // deadband slopes before accel so 1-LSB flips don't create false d2T
  float slopeForAcc = (fabsf(f.tempSlope) < DEADBAND_TEMP_SLOPE) ? 0.0f : f.tempSlope;
  float prevForAcc = (isnan(prevTempSlope) || fabsf(prevTempSlope) < DEADBAND_TEMP_SLOPE)
                       ? 0.0f : prevTempSlope;
  f.varI = nz(variance(false));
  f.powerW = LINE_VOLTAGE_V * fabsf(currentA);
  f.tempAcc = isnan(prevTempSlope) ? 0.0f : (slopeForAcc - prevForAcc) / LOOP_DT_S;
  // target is assigned only when a full batch collapses into dataset[]
  f.target = 0;

  latest = f;
  if (batchCount < BATCH_SIZE) batch[batchCount++] = f;

  evaluatePrediction(f);

  Serial.printf(
    "%2d %5.3f %5.2f %5.3f %5.2f %6.3f %6.3f %6.4f %6.1f %7.4f  risk=%4.1f%% %s w=%d\n",
    batchCount, f.currentA, f.tempC, f.ma3I, f.ma3T,
    f.currentSlope, f.tempSlope, f.varI, f.powerW, f.tempAcc,
    riskPercent, overallStatus, warningCount
  );

  // compact GNB line every loop when model exists
  if (gnbReady) {
    Serial.printf("  [GNB] %s pred=%s conf=%.2f rule=%.2f %s\n",
                  gnbActive ? "ACTIVE" : "standby",
                  targetName(gnbPredClass), gnbConfidence, ruleConfidence, gnbStatusMsg);
  }

  if (batchCount >= BATCH_SIZE) collapseBatchToAverage();

  prevTempSlope = slopeForAcc;

  // remind if nobody is connected to the SoftAP
  static unsigned long lastApLog = 0;
  if (millis() - lastApLog > 15000) {
    lastApLog = millis();
    Serial.printf("[AP] clients=%d  open http://192.168.4.1 on SSID %s\n",
                  WiFi.softAPgetStationNum(), AP_SSID);
  }

  serveClientsFor((unsigned long)(LOOP_DT_S * 1000));
}
