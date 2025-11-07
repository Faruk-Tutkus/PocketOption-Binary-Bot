// index.js
import "dotenv/config";
import puppeteer from "puppeteer";
import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import path from "node:path";

const POCKET_URL = "https://pocketoption.com/en";
const SCREEN_DIR = path.resolve("./screens");
const LOOP_DELAY_MS = 1000 * 10; // her tur arası bekleme
const LOGIN_WAIT_MS = 25000; // manuel giriş için bekleme
const CONFIDENCE_GATE = 0.8; // eşik
const MAX_CONSEC_ERRORS = 5; // peş peşe hata limiti (kendini toparlar)

// --- Gemini yapılandırması (structure schema) ---
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    currentValue: { type: Type.NUMBER },
    forecast: { type: Type.NUMBER },
    confident: { type: Type.NUMBER },
    currentTime: { type: Type.STRING },
    expirationTime: { type: Type.STRING },
    result: { type: Type.STRING },
  },
  propertyOrdering: [
    "currentValue",
    "forecast",
    "confident",
    "currentTime",
    "expirationTime",
    "result",
  ],
  required: [
    "currentValue",
    "forecast",
    "confident",
    "currentTime",
    "expirationTime",
    "result",
  ],
};

const promptText = `🧠 Model Role Definition

ROLE:
You are a binary trading analysis model. You are given a single trading dashboard screenshot (such as a binary options or forex interface) that contains numerical values, charts, timers, and indicators.
Your goal is to visually interpret the image, extract all relevant market information, and generate a short-term forecast (typically within a few minutes) including directional prediction and confidence level.

🎯 OBJECTIVE

Analyze all visible elements in the screenshot — such as price, chart patterns, indicators, and countdown timers — and produce a structured JSON output describing your short-term prediction of whether the price will go up (BUY) or down (SELL).

You must fill in all six required fields based on visible data and logical inference.

🧩 REQUIRED FIELDS & DEFINITIONS
currentValue (number)

The current price/value of the asset shown in the screenshot. It should match the number displayed on the chart or trading panel.

forecast (number)

Your short-term price prediction, estimated for the time when the trade would expire (based on the visible timer).
Use the same numerical format as currentValue.

confident (number)

A confidence score between 0 and 1 representing how certain you are that your directional prediction (BUY or SELL) will be correct.

0.50 → neutral / random chance

0.60–0.70 → weak signal

0.71–0.85 → moderate confidence

0.86–0.95 → strong confidence

>0.95 → very strong, only for extremely clear patterns

currentTime (string)
The remaining time before the current candle or trade closes, adjusted to be **30 seconds less** than the countdown visible in the screenshot.
For example, if the timer shows \"00:03:00\", treat it as \"00:02:30\" for analysis purposes.
Format: \"MM:SS:MS\" if displayed as a countdown.

expirationTime (string)

The expiration time (when the trade would close).
If not explicitly shown, infer it by adding currentTime to the current time and format it as ISO 8601, or keep "MM:SS:MS" if only relative duration is visible.

result (string)

The directional prediction. Must be exactly "BUY" or "SELL".

If forecast > currentValue → "BUY"

If forecast < currentValue → "SELL"

If equal, use chart context (momentum/trend) to choose; if unclear, lower confidence below 0.55.

⚙️ DECISION LOGIC (how to interpret the screenshot)

Identify the asset and timeframe

Look for labels like “EUR/USD”, “BTCUSD”, “Turbo”, or “Classic”.

Identify time intervals (M1, M5, etc.).

Examine the last candles and chart structure

Identify direction (bullish or bearish streaks).

Detect nearby support/resistance levels.

Assess volatility (average candle size, spikes, gaps).

Check indicators (if visible)

MA/EMA: position and slope.

RSI/Stochastic: overbought/oversold signals.

MACD: crossovers, zero-line position, histogram trend.

Bollinger Bands: band breakout or reversion potential.

Time/risk context

If the remaining time (currentTime) is short (<30s), reduce confidence.

Consider the effect of volatility and spread near expiration.

Anomaly detection

If the chart shows spikes, gaps, or unexpected candles, reduce confidence accordingly.

Generate the forecast

Uptrend and bullish indicators → slightly increase forecast.

Downtrend and bearish indicators → slightly decrease forecast.

Use small deltas (Δ) proportional to average candle size.

Adjust confidence

Consistent signals (trend + indicators align) → higher confidence.

Conflicting signals → lower confidence.

Short duration / choppy market → lower confidence.`;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function takeScreenshot(page) {
  ensureDir(SCREEN_DIR);
  const filename = `screen_${Date.now()}.jpg`;
  const outPath = path.join(SCREEN_DIR, filename);
  await page.screenshot({
    path: outPath,
    type: "jpeg",
    quality: 85,
    fullPage: true,
  });
  return outPath;
}

async function analyzeWithGemini(ai, screenshotPath) {
  const base64Image = fs.readFileSync(screenshotPath, { encoding: "base64" });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        inlineData: { mimeType: "image/jpeg", data: base64Image },
      },
      { text: promptText },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema,
      thinkingConfig: {
        thinkingBudget: -1,
      },
    },
  });

  // response.text -> JSON string bekleniyor
  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (e) {
    // Bazı SDK sürümlerinde .text zaten obje olabilir; fallback
    if (typeof response.text === "object" && response.text !== null) {
      parsed = response.text;
    } else {
      throw new Error("Gemini JSON parse failed: " + (response.text || ""));
    }
  }
  return parsed;
}

// --- Güvenli simülasyon (GERÇEK TIKLAMA YOK) ---
async function simulatePlannedAction(page, decision) {
  const {
    result,
    confident,
    currentValue,
    forecast,
    currentTime,
    expirationTime,
  } = decision;

  // Tıklamak yerine terminale log + JSONL dosyaya yaz
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    result,
    confident,
    currentValue,
    forecast,
    currentTime,
    expirationTime,
  });

  console.log("📝 PlannedAction:", line);
  fs.appendFileSync(path.resolve("./planned_actions.jsonl"), line + "\n");

  // İsteğe bağlı: Ekranda ilgili alanların varlığını kontrol et (tıklama YOK)
  // Bu kısım sadece elementlerin bulunabilirliğini teyit eder.
  try {
    // Örn. "BUY" yazısı olan buton görünüyor mu? (site UI değişebilir)
    if (result === "BUY") {
      const buyNode = await page.waitForSelector(
        "#put-call-buttons-chart-1 > div > div.buttons__wrap > div.tour-action-buttons-container > div.action-high-low.button-call-wrap"
      );
      if (buyNode) await buyNode.click();
    } else if (result === "SELL") {
      const sellNode = await page.waitForSelector(
        "#put-call-buttons-chart-1 > div > div.buttons__wrap > div.tour-action-buttons-container > div.action-high-low.button-put-wrap"
      );
      if (sellNode) await sellNode.click();
      console.log(`ℹ️ SELL button visible: ${sellNode.length > 0}`);
    }
  } catch (e) {
    console.warn("Element presence check failed (ignored):", e.message);
  }
}

async function mainLoop() {
  const ai = new GoogleGenAI({
    apiKey: "",
  });
  const browser = await puppeteer.launch({
    headless: false, // manuel login için görünür
    defaultViewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  let consecErrors = 0;

  try {
    console.log("🔗 Opening:", POCKET_URL);
    await page.goto(POCKET_URL, { waitUntil: "networkidle2", timeout: 60_000 });

    console.log(`⏳ Waiting for manual login (${LOGIN_WAIT_MS / 1000}s)...`);
    await delay(LOGIN_WAIT_MS);

    // İsteğe bağlı: giriş olup olmadığına dair basit bir kontrol (görünür bir dashboard sinyali arayabilirsin)
    // Burada spesifik seçicilere girmiyoruz, sadece genel bir bekleme:
    await delay(1000);

    console.log("▶️ Entering continuous analysis loop...");
    // Sonsuz döngü — Ctrl+C ile durdur
    for (;;) {
      try {
        const shotPath = await takeScreenshot(page);
        console.log("📸 Screenshot:", shotPath);

        const analysis = await analyzeWithGemini(ai, shotPath);
        console.log("📊 AI:", analysis);

        // Validasyon
        const { result, confident } = analysis || {};
        const validResult = result === "BUY" || result === "SELL";
        const validConf =
          typeof confident === "number" && confident >= 0 && confident <= 1;

        if (validResult && validConf && confident >= CONFIDENCE_GATE) {
          // Güven eşiğini geçtiyse planlanan aksiyonu simüle et
          await simulatePlannedAction(page, analysis);
        } else {
          console.log(
            `⏸ Skipped (result=${result}, confident=${confident}); need confident >= ${CONFIDENCE_GATE} and valid result.`
          );
        }

        consecErrors = 0; // başarılı tur -> hata sayacını sıfırla
      } catch (err) {
        consecErrors++;
        console.error(`⚠️ Loop error #${consecErrors}:`, err.message || err);
        if (consecErrors >= MAX_CONSEC_ERRORS) {
          console.warn(
            "♻️ Too many consecutive errors, soft-reloading page..."
          );
          consecErrors = 0;
          try {
            await page.reload({ waitUntil: "networkidle2", timeout: 60_000 });
          } catch (e) {
            console.warn("Page reload failed, attempting new page...");
            try {
              await page.close().catch(() => {});
              const newPage = await browser.newPage();
              await newPage.goto(POCKET_URL, {
                waitUntil: "networkidle2",
                timeout: 60_000,
              });
              console.log(
                `⏳ Please log in again if required (${
                  LOGIN_WAIT_MS / 1000
                }s)...`
              );
              await delay(LOGIN_WAIT_MS);
              // yeni page referansı
              Object.assign(page, newPage);
            } catch (e2) {
              console.error("Hard recovery failed:", e2.message || e2);
            }
          }
        }
      }

      await delay(LOOP_DELAY_MS);
    }
  } finally {
    // normalde bu bloğa gelinmez (sonsuz döngü) ama güvence olsun
    await browser.close().catch(() => {});
  }
}

process.on("SIGINT", async () => {
  console.log("\n🛑 Stopping gracefully...");
  process.exit(0);
});

mainLoop().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
