// api/universe.js
// Universe scan endpoint.
// Automatic universe flow — all views (map, board, portfolio, alerts) read from this snapshot.
//
// GET /api/universe              → returns cached snapshot (or runs scan if none)
// GET /api/universe?refresh=true → forces a fresh scan
// GET /api/universe?limit=50     → scans only first N tickers (for testing)

import { getEngineUniverse, runUniverseScan } from "./_engine.js";

// In-memory cache (persists within a Vercel function instance lifecycle)
let _snapshot = null;
let _snapshotAge = null;
// 30 minutes: long enough to avoid hammering the external API on every page load,
// short enough to pick up meaningful intraday moves. Override with ?refresh=true.
const CACHE_TTL_MS = 30 * 60 * 1000;

function isCacheStale() {
  if (!_snapshot || !_snapshotAge) return true;
  return Date.now() - _snapshotAge > CACHE_TTL_MS;
}

export function getUniverseSnapshot() {
  return _snapshot;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const forceRefresh = req.query?.refresh === "true";
  const limit = parseInt(req.query?.limit, 10) || undefined;

  try {
    if (forceRefresh || isCacheStale()) {
      const universe = getEngineUniverse();
      const scanOpts = limit ? { limit } : {};
      const scan = await runUniverseScan(universe, scanOpts);

      _snapshot = scan;
      _snapshotAge = Date.now();

      // Debug counts surfaced on every scan
      console.log("[universe] scan complete", {
        universe_count: scan.universe_count,
        scan_count: scan.scan_count,
        failure_count: scan.failure_count,
        snapshot_time: scan.snapshot_time,
      });
    }

    if (!_snapshot) {
      return res.status(503).json({ error: "Snapshot not available. Retry with ?refresh=true" });
    }

    // Sanity checks surfaced in response
    const s = _snapshot;
    const mapTickers       = s.results.length;
    const boardTickers     = s.results.length;
    const portfolioEligible = s.results.filter(r => r.conviction_score >= 0.5).length;

    return res.status(200).json({
      ...s,
      debug: {
        universe_count:      s.universe_count,
        scan_count:          s.scan_count,
        failure_count:       s.failure_count,
        map_tickers:         mapTickers,
        board_tickers:       boardTickers,
        portfolio_eligible:  portfolioEligible,
        cache_age_ms:        _snapshotAge ? Date.now() - _snapshotAge : null,
      },
    });
  } catch (err) {
    return res.status(500).json({
      error: "Internal Server Error",
      details: err?.message || String(err),
    });
  }
}
