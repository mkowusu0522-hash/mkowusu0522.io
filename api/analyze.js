// api/analyze.js
// Single-ticker analysis endpoint.
// Manual ticker flow — does NOT affect the universe snapshot.
//
// GET /api/analyze?ticker=AAPL

import { analyzeOneTicker } from "./_engine.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const ticker = (req.query?.ticker || "").trim().toUpperCase();
  if (!ticker) {
    return res.status(400).json({ error: "Missing required query param: ticker" });
  }

  try {
    const result = await analyzeOneTicker(ticker);
    if (!result) {
      return res.status(404).json({ error: `No data available for ticker: ${ticker}` });
    }
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      error: "Internal Server Error",
      details: err?.message || String(err),
    });
  }
}
