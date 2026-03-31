// api/_engine.js
// Shared capital allocation engine.
// All universe and ticker analysis flows read from this module.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STOCK_ENGINE_BASE = "https://stock-engine-api.onrender.com";

// ── Universe source ────────────────────────────────────────────────────────────
// One canonical function. All callers get the same list.
let _cachedUniverse = null;
export function getEngineUniverse() {
  if (_cachedUniverse) return _cachedUniverse;
  const filePath = resolve(__dirname, "../sp500_tickers.json");
  _cachedUniverse = JSON.parse(readFileSync(filePath, "utf8"));
  return _cachedUniverse;
}

// ── Ticker context ─────────────────────────────────────────────────────────────
let _cachedContext = null;
function loadContext() {
  if (_cachedContext) return _cachedContext;
  const filePath = resolve(__dirname, "../data/ticker_context.json");
  _cachedContext = JSON.parse(readFileSync(filePath, "utf8"));
  return _cachedContext;
}

export function getTickerContext(ticker) {
  const ctx = loadContext();
  return ctx[ticker] || null;
}

// ── Raw API call ───────────────────────────────────────────────────────────────
// Calls the external stock engine for one ticker. Returns raw response or null on failure.
async function fetchRawTickerData(ticker) {
  try {
    const res = await fetch(`${STOCK_ENGINE_BASE}/stock/${ticker}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Scoring constants ──────────────────────────────────────────────────────────
// Structural score weights (must sum to 1.0)
const ECONOMIC_WEIGHT      = 0.4;  // economic quality is the primary gate
const SURVIVABILITY_WEIGHT = 0.3;  // cash conversion durability
const ROIC_WEIGHT          = 0.3;  // return on capital consistency

// Conviction score weight split between structural quality and valuation
const STRUCTURAL_CONVICTION_WEIGHT = 0.7;
const PRICE_CONVICTION_WEIGHT      = 0.3;

// Coordinate system: structural_score 0→1 is mapped to x ∈ (-5, +5)
// so 0.5 (neutral) → 0, 1.0 (best) → +5, 0.0 (worst) → -5
const COORDINATE_MIDPOINT     = 0.5;
const COORDINATE_SCALE_FACTOR = 10;

// Y-axis base offsets for price pass/fail, further shifted by ROIC continuity
const PRICE_PASS_Y_OFFSET = 3.0;
const PRICE_FAIL_Y_OFFSET = -3.0;

// Minimum ROIC hit-rate change to trigger a structural alert
export const ROIC_ALERT_THRESHOLD = 0.1;

// ── Data contract mapping ──────────────────────────────────────────────────────
// Converts raw external API response to the canonical data contract.
// Both universe scan and single-ticker analysis use this same mapping.
export function mapToContract(ticker, raw, snapshotTime) {
  if (!raw) return null;

  const economicPass = Boolean(raw.economic_quality_pass);
  const pricePass    = Boolean(raw.price_pass);
  const survivePass  = Boolean(raw.survivability_pass);
  const roicHitRate  = typeof raw.roic_hit_rate === "number" ? raw.roic_hit_rate : 0;

  // Structural score: quality and durability (0 → 1)
  const structuralScore = (
    (economicPass ? ECONOMIC_WEIGHT      : 0) +
    (survivePass  ? SURVIVABILITY_WEIGHT : 0) +
    (roicHitRate  * ROIC_WEIGHT)
  );

  // Conviction score: structural + valuation (0 → 1)
  const convictionScore =
    structuralScore * STRUCTURAL_CONVICTION_WEIGHT +
    (pricePass ? PRICE_CONVICTION_WEIGHT : 0);

  // Map coordinates
  // x = structural quality axis (structural_score 0→1 maps to -5→+5)
  // y = price attractiveness axis (price_pass splits positive/negative,
  //     further modulated by ROIC hit rate for within-band differentiation)
  const x = parseFloat(((structuralScore - COORDINATE_MIDPOINT) * COORDINATE_SCALE_FACTOR).toFixed(2));
  const y = parseFloat(
    ((pricePass ? PRICE_PASS_Y_OFFSET : PRICE_FAIL_Y_OFFSET) + (roicHitRate - COORDINATE_MIDPOINT)).toFixed(2)
  );

  // Zone classification
  const zone = x >= 0 && y >= 0 ? "Q1" :
               x >= 0 && y <  0 ? "Q4" :
               x <  0 && y >= 0 ? "Q2" : "Q3";

  const quadrantLabel = {
    Q1: "Compounder",
    Q4: "Hold / Wait",
    Q2: "Speculative",
    Q3: "Avoid",
  }[zone];

  // Board lane based on conviction
  const boardLane =
    convictionScore >= 0.7 ? "Core" :
    convictionScore >= 0.5 ? "Watch" :
    convictionScore >= 0.3 ? "Caution" : "Avoid";

  // Structural read (narrative)
  const structuralRead = buildStructuralRead(economicPass, survivePass, roicHitRate, pricePass);

  // Primary failure (first broken gate)
  const primaryFailure =
    !economicPass  ? "economic_quality" :
    !survivePass   ? "survivability" :
    roicHitRate < 0.75 ? "roic_durability" :
    !pricePass     ? "price" : null;

  return {
    ticker,
    x,
    y,
    zone,
    quadrant: quadrantLabel,
    structural_read: structuralRead,
    verdict: raw.judgment_verdict || (boardLane === "Core" ? "Yes" : boardLane === "Avoid" ? "No" : "Not Yet"),
    board_lane: boardLane,
    primary_failure: primaryFailure,
    structural_score: parseFloat(structuralScore.toFixed(3)),
    conviction_score: parseFloat(convictionScore.toFixed(3)),
    metrics: {
      economic_quality_pass: economicPass,
      price_pass: pricePass,
      survivability_pass: survivePass,
      roic_hit_rate: roicHitRate,
    },
    timestamp: snapshotTime || new Date().toISOString(),
  };
}

function buildStructuralRead(economicPass, survivePass, roicHitRate, pricePass) {
  const parts = [];
  if (economicPass) parts.push("generates economic value");
  else parts.push("does not consistently generate economic value");
  if (survivePass) parts.push("converts operations into reliable cash");
  else parts.push("cash conversion is unreliable");
  if (roicHitRate >= 0.75) parts.push("returns appear durable");
  else parts.push("return durability is low");
  if (pricePass) parts.push("price supports the required return");
  else parts.push("price is the constraint on the required return");
  return parts.join("; ") + ".";
}

// ── Structural vs judgment alert classification ─────────────────────────────────
// Structural alerts: reality changed (metrics flipped)
// Judgment alerts: verdict/board_lane changed (decision state changed)
export function classifyAlerts(prev, next) {
  if (!prev || !next) return { structural: [], judgment: [] };

  const structural = [];
  const judgment   = [];
  const t = next.ticker;
  const ts = next.timestamp;

  const structuralFields = [
    ["economic_quality_pass", "Economic quality"],
    ["survivability_pass",    "Survivability"],
    ["price_pass",            "Price attractiveness"],
  ];

  for (const [field, label] of structuralFields) {
    if (prev.metrics[field] !== next.metrics[field]) {
      structural.push({
        ticker: t,
        reason_code: `structural.${field}`,
        label,
        from: prev.metrics[field],
        to: next.metrics[field],
        timestamp: ts,
      });
    }
  }

  if (
    Math.abs((prev.metrics.roic_hit_rate || 0) - (next.metrics.roic_hit_rate || 0)) >= ROIC_ALERT_THRESHOLD
  ) {
    structural.push({
      ticker: t,
      reason_code: "structural.roic_hit_rate",
      label: "ROIC hit rate",
      from: prev.metrics.roic_hit_rate,
      to: next.metrics.roic_hit_rate,
      timestamp: ts,
    });
  }

  if (prev.verdict !== next.verdict) {
    judgment.push({
      ticker: t,
      reason_code: "judgment.verdict",
      label: "Verdict",
      from: prev.verdict,
      to: next.verdict,
      timestamp: ts,
    });
  }

  if (prev.board_lane !== next.board_lane) {
    judgment.push({
      ticker: t,
      reason_code: "judgment.board_lane",
      label: "Board lane",
      from: prev.board_lane,
      to: next.board_lane,
      timestamp: ts,
    });
  }

  return { structural, judgment };
}

// ── Single ticker analysis ─────────────────────────────────────────────────────
// Manual ticker flow — separate from universe scan.
export async function analyzeOneTicker(ticker) {
  const raw = await fetchRawTickerData(ticker);
  if (!raw) return null;
  const result = mapToContract(ticker, raw, new Date().toISOString());
  if (!result) return null;
  result.context = getTickerContext(ticker);
  return result;
}

// ── Universe scan ──────────────────────────────────────────────────────────────
// Runs the full universe scan with concurrency control.
// limit: max tickers to scan (default: all). concurrency: parallel requests.
export async function runUniverseScan(tickers, { limit = tickers.length, concurrency = 8 } = {}) {
  const universe = tickers.slice(0, limit);
  const snapshotTime = new Date().toISOString();
  const results = [];
  const failures = [];

  // Scan in batches to respect concurrency
  for (let i = 0; i < universe.length; i += concurrency) {
    const batch = universe.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (ticker) => {
        const raw = await fetchRawTickerData(ticker);
        if (!raw) { failures.push(ticker); return null; }
        return mapToContract(ticker, raw, snapshotTime);
      })
    );
    for (const r of settled) {
      if (r.status === "fulfilled" && r.value) results.push(r.value);
    }
  }

  return {
    snapshot_time: snapshotTime,
    universe_count: universe.length,
    scan_count: results.length,
    failure_count: failures.length,
    failures,
    results,
  };
}
